"use client";

import { useState } from "react";
import type { AgentPlatformClient } from "@repo/sdk";
import { fields, display } from "@repo/web/components/dashboard-utils";

type Actions = {
  client: AgentPlatformClient;
  id: string;
  writable: boolean;
  act(action: () => Promise<unknown>, message?: string): Promise<unknown>;
};

export function FileControls({ client, id, writable, act }: Actions) {
  const [content, setContent] = useState("");
  const [result, setResult] = useState<unknown>();
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        const data = fields(event);
        void act(async () => {
          const op = String(data.operation) as Parameters<
            typeof client.files
          >[1]["op"];
          const bytes = new TextEncoder().encode(content);
          let encoded = "";
          if (op === "write") {
            if (bytes.length > 8 * 1048576)
              throw new Error("File exceeds 8 MB");
            for (let offset = 0; offset < bytes.length; offset += 8192)
              encoded += String.fromCharCode(
                ...bytes.subarray(offset, offset + 8192),
              );
          }
          const value = await client.files(id, {
            op,
            path: String(data.path),
            destination: String(data.destination || "") || undefined,
            data: op === "write" ? btoa(encoded) : undefined,
          });
          setResult(value);
          if (op === "read" && typeof value.data === "string")
            setContent(
              new TextDecoder().decode(
                Uint8Array.from(atob(value.data), (character) =>
                  character.charCodeAt(0),
                ),
              ),
            );
        }, "");
      }}
    >
      <h3 className="wide">Workspace files</h3>
      <label>
        Operation
        <select name="operation">
          <option value="list">List directory</option>
          <option value="read">Read file</option>
          <option value="stat">File information</option>
          {writable && (
            <>
              <option value="write">Save file</option>
              <option value="mkdir">Create directory</option>
              <option value="move">Move file</option>
              <option value="delete">Delete file or empty directory</option>
            </>
          )}
        </select>
      </label>
      <label>
        Path
        <input name="path" defaultValue="." required />
      </label>
      {writable && (
        <label className="wide">
          Destination for move
          <input name="destination" placeholder="folder/new-name.txt" />
        </label>
      )}
      <label className="wide">
        Text content
        <textarea
          rows={10}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          readOnly={!writable}
          spellCheck={false}
        />
      </label>
      <button className="pixel-button" type="submit">
        Apply operation
      </button>
      {writable && (
        <button
          className="pixel-button"
          type="button"
          onClick={(event) => {
            const form = event.currentTarget.form!;
            const path = String(new FormData(form).get("path"));
            void act(
              () =>
                client.collectArtifact(id, {
                  path,
                  filename: path.split("/").at(-1) || "file",
                }),
              "File collected in Artifacts.",
            );
          }}
        >
          Collect artifact
        </button>
      )}
      {result !== undefined && <pre className="wide">{display(result)}</pre>}
    </form>
  );
}

export function BrowserControls({ client, id, writable, act }: Actions) {
  const [result, setResult] = useState<unknown>();
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        const data = fields(event);
        void act(async () => {
          const action = String(data.action);
          const value = await client.browserAction(id, {
            action,
            ...(action === "navigate" ? { url: String(data.url) } : {}),
            ...(["click", "type", "download"].includes(action)
              ? { selector: String(data.selector) }
              : {}),
            ...(action === "type" ? { text: String(data.text) } : {}),
            ...(action === "scroll" ? { y: Number(data.y) } : {}),
          });
          setResult(value);
        }, "");
      }}
    >
      <h3 className="wide">Browser controls</h3>
      <label>
        Action
        <select name="action">
          <option value="inspect">Inspect page</option>
          {writable && (
            <>
              <option value="navigate">Navigate</option>
              <option value="click">Click element</option>
              <option value="type">Type text</option>
              <option value="scroll">Scroll</option>
              <option value="screenshot">Save screenshot</option>
              <option value="download">Collect download</option>
              <option value="persist">Save browser state</option>
              <option value="restore">Restore browser state</option>
            </>
          )}
        </select>
      </label>
      <label>
        URL
        <input
          name="url"
          type="url"
          placeholder="https://allowed.example.com"
        />
      </label>
      <label>
        Element selector
        <input name="selector" placeholder="button[type=submit]" />
      </label>
      <label>
        Scroll distance
        <input
          name="y"
          type="number"
          min={-10000}
          max={10000}
          defaultValue={600}
        />
      </label>
      <label className="wide">
        Text
        <input name="text" />
      </label>
      <button className="pixel-button" type="submit">
        Run action
      </button>
      {result !== undefined && <pre className="wide">{display(result)}</pre>}
    </form>
  );
}
