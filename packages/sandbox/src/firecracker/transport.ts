import http from "node:http";
import type { Socket } from "node:net";
import { SandboxError } from "../contracts";

const maxResponse = 24 * 1048576;

export function managerRequest<T>(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 90000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { socketPath, method, path, timeout: timeoutMs },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxResponse)
            response.destroy(new Error("FIRECRACKER_RESPONSE_LIMIT"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const value = chunks.length
              ? JSON.parse(Buffer.concat(chunks).toString())
              : undefined;
            if ((response.statusCode ?? 500) >= 300) {
              reject(
                new SandboxError(
                  value?.code ?? "FIRECRACKER_REQUEST_FAILED",
                  value?.message ?? "Firecracker host request failed.",
                  response.statusCode,
                ),
              );
            } else resolve(value as T);
          } catch {
            reject(new Error("FIRECRACKER_INVALID_RESPONSE"));
          }
        });
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("FIRECRACKER_REQUEST_TIMEOUT")),
    );
    request.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        ["ENOENT", "ECONNREFUSED", "EACCES"].includes(error.code ?? "")
          ? new SandboxError(
              "FIRECRACKER_HOST_UNAVAILABLE",
              "Cannot access the Firecracker host service. See docs/firecracker-runtime.md.",
            )
          : error,
      ),
    );
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** Upgrade only after the manager has connected the guest supervisor. */
export function managerStream(
  socketPath: string,
  id: string,
  kind: string,
  signal?: AbortSignal,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath,
      method: "POST",
      path: `/vms/${id}/stream/${kind}`,
      headers: { Connection: "Upgrade", Upgrade: "zlayer-guest" },
      signal,
      timeout: 15000,
    });
    request.once("upgrade", (_response, socket, head) => {
      request.setTimeout(0);
      if (head.length) socket.unshift(head);
      socket.on("error", () => {});
      resolve(socket);
    });
    request.once("response", (response) => {
      response.resume();
      reject(
        new SandboxError(
          "FIRECRACKER_GUEST_UNAVAILABLE",
          "The Firecracker guest is unavailable.",
          response.statusCode,
        ),
      );
    });
    request.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        ["ENOENT", "ECONNREFUSED", "EACCES"].includes(error.code ?? "")
          ? new SandboxError(
              "FIRECRACKER_HOST_UNAVAILABLE",
              "Cannot access the Firecracker host service. See docs/firecracker-runtime.md.",
            )
          : error,
      ),
    );
    request.once("timeout", () =>
      request.destroy(new Error("FIRECRACKER_GUEST_TIMEOUT")),
    );
    request.end();
  });
}
