import { ToolRegistry, type Tool } from "./index";
import type { ExecuteResult } from "@repo/shared";
interface Operations {
  execute(
    id: string,
    command: string,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<ExecuteResult>;
  file<T>(id: string, operation: Record<string, unknown>): Promise<T>;
  service<T>(id: string, action: Record<string, unknown>): Promise<T>;
}
export function sandboxTools(
  operations: Operations,
  browserId: string,
  collect?: (
    data: string,
    filename: string,
    mimeType: string,
  ) => Promise<unknown>,
  lifecycle?: { opened(): Promise<void>; closed(): Promise<void> },
) {
  const registry = new ToolRegistry();
  const register = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    permission: string,
    risk: Tool["risk"],
    execute: Tool["execute"],
  ) =>
    registry.register({
      name,
      description,
      inputSchema: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
      permission,
      risk,
      version: "1",
      timeoutMs: 35000,
      validate: (input) => input as Record<string, unknown>,
      execute,
    });
  const path = { type: "string", maxLength: 4096 };
  register(
    "execute_command",
    "Execute a bounded shell command",
    { command: { type: "string", minLength: 1, maxLength: 4000 } },
    ["command"],
    "sandbox.execute",
    "execute",
    (input, context) =>
      operations.execute(context.sandboxId, input.command as string, {
        signal: context.signal,
        timeoutMs: 30000,
      }),
  );
  register(
    "read_file",
    "Read a UTF-8 file from the workspace",
    { path },
    ["path"],
    "files.read",
    "read",
    async (input, context) => {
      const result = await operations.file<{ data: string }>(
        context.sandboxId,
        { op: "read", path: input.path },
      );
      return {
        content: Buffer.from(result.data, "base64")
          .toString("utf8")
          .slice(0, 30000),
      };
    },
  );
  register(
    "write_file",
    "Write UTF-8 content to a workspace file",
    { path, content: { type: "string", maxLength: 100000 } },
    ["path", "content"],
    "files.write",
    "write",
    (input, context) =>
      operations.file(context.sandboxId, {
        op: "write",
        path: input.path,
        data: Buffer.from(input.content as string).toString("base64"),
      }),
  );
  register(
    "list_directory",
    "List workspace directory entries",
    { path },
    ["path"],
    "files.read",
    "read",
    (input, context) =>
      operations.file(context.sandboxId, { op: "list", path: input.path }),
  );
  const browser = async (
    sandboxId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) => {
    signal.throwIfAborted();
    const close = async () => {
      await operations.service(sandboxId, {
        op: "browser.close",
        id: browserId,
      });
      await lifecycle?.closed();
    };
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => {
        void close().catch(() => {});
        reject(signal.reason ?? new Error("BROWSER_CANCELLED"));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
    const work = async () => {
      try {
        return await operations.service<Record<string, unknown>>(sandboxId, {
          ...input,
          id: browserId,
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BROWSER_SESSION_LOST"
        )
          throw error;
        signal.throwIfAborted();
        await operations.service(sandboxId, {
          op: "browser.create",
          id: browserId,
        });
        if (signal.aborted) {
          await close();
          signal.throwIfAborted();
        }
        try {
          await lifecycle?.opened();
        } catch (failure) {
          await close();
          throw failure;
        }
        return operations.service<Record<string, unknown>>(sandboxId, {
          ...input,
          id: browserId,
        });
      }
    };
    try {
      return await Promise.race([work(), cancelled]);
    } finally {
      if (abort) signal.removeEventListener("abort", abort);
    }
  };
  register(
    "browser_navigate",
    "Navigate an isolated browser to a permitted website",
    { url: { type: "string", maxLength: 4096 } },
    ["url"],
    "browser.write",
    "execute",
    (input, context) =>
      browser(
        context.sandboxId,
        { op: "browser.navigate", url: input.url },
        context.signal,
      ),
  );
  register(
    "browser_interact",
    "Click or type in the isolated browser",
    {
      action: { type: "string", enum: ["click", "type"] },
      selector: { type: "string", maxLength: 1000 },
      text: { type: "string", maxLength: 10000 },
    },
    ["action", "selector"],
    "browser.write",
    "execute",
    (input, context) =>
      browser(
        context.sandboxId,
        {
          op: `browser.${input.action}`,
          selector: input.selector,
          text: input.text ?? "",
        },
        context.signal,
      ),
  );
  register(
    "browser_inspect",
    "Inspect browser text and current URL",
    {},
    [],
    "browser.read",
    "read",
    (_input, context) =>
      browser(context.sandboxId, { op: "browser.inspect" }, context.signal),
  );
  register(
    "browser_screenshot",
    "Collect a browser screenshot artifact",
    {},
    [],
    "browser.write",
    "write",
    async (_input, context) => {
      if (!collect) throw new Error("ARTIFACT_STORAGE_REQUIRED");
      const result = await browser(
        context.sandboxId,
        {
          op: "browser.screenshot",
        },
        context.signal,
      );
      return collect(result.data as string, `${browserId}.png`, "image/png");
    },
  );
  register(
    "browser_download",
    "Collect a download from a browser element",
    { selector: { type: "string", maxLength: 1000 } },
    ["selector"],
    "browser.write",
    "write",
    async (input, context) => {
      if (!collect) throw new Error("ARTIFACT_STORAGE_REQUIRED");
      const result = await browser(
        context.sandboxId,
        {
          op: "browser.download",
          selector: input.selector,
        },
        context.signal,
      );
      return collect(
        result.data as string,
        result.filename as string,
        "application/octet-stream",
      );
    },
  );
  return registry;
}
