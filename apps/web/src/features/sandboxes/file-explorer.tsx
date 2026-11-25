"use client";
import { useState } from "react";
import { z } from "zod";
import {
  Button,
  Input,
  Textarea,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Alert,
  AlertDescription,
} from "@repo/ui";
import { File, Folder, Save } from "lucide-react";
import {
  useFileOperation,
  useCollectArtifact,
  fileOperationSchema,
} from "@repo/web/hooks/api/sandboxes";
import {
  ActionForm,
  ChoiceSelect,
  Field,
} from "@repo/web/components/shared/forms";
import { ErrorAlert } from "@repo/web/components/shared/feedback";
import { display } from "@repo/web/lib/format";
export function FileExplorer({
  sandboxId,
  writable,
}: {
  sandboxId: string;
  writable: boolean;
}) {
  const operation = useFileOperation();
  const collect = useCollectArtifact();
  const [content, setContent] = useState("");
  const [path, setPath] = useState(".");
  const entries = z
    .object({
      entries: z.array(
        z.object({
          name: z.string(),
          directory: z.boolean(),
          symlink: z.boolean(),
        }),
      ),
    })
    .safeParse(operation.data);
  return (
    <div className="space-y-5">
      <Alert>
        <AlertDescription>
          Files live inside this sandbox. Save a file to Artifacts to keep it
          after the sandbox is destroyed.
        </AlertDescription>
      </Alert>
      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">Browse & read</TabsTrigger>
          {writable && <TabsTrigger value="edit">Edit & organize</TabsTrigger>}
        </TabsList>
        <TabsContent value="browse" className="mt-5">
          <ActionForm
            schema={z.object({
              path: z.string().min(1),
              op: z.enum(["list", "read", "stat"]),
            })}
            pending={operation.isPending}
            submit="Open path"
            onSubmit={async (input) => {
              const result = await operation.mutateAsync({
                sandboxId,
                ...input,
              });
              const file = z.object({ data: z.string() }).safeParse(result);
              if (file.success) {
                setContent(
                  new TextDecoder().decode(
                    Uint8Array.from(atob(file.data.data), (character) =>
                      character.charCodeAt(0),
                    ),
                  ),
                );
              }
            }}
          >
            <Field label="Path">
              <Input
                name="path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
              />
            </Field>
            <Field label="Operation">
              <ChoiceSelect
                name="op"
                defaultValue="list"
                options={[
                  { value: "list", label: "List directory" },
                  { value: "read", label: "Read file" },
                  { value: "stat", label: "File information" },
                ]}
              />
            </Field>
          </ActionForm>
        </TabsContent>
        {writable && (
          <TabsContent value="edit" className="mt-5">
            <ActionForm
              schema={fileOperationSchema}
              pending={operation.isPending}
              submit="Apply operation"
              onSubmit={async (input) => {
                const data =
                  input.op === "write"
                    ? btoa(
                        Array.from(new TextEncoder().encode(content), (byte) =>
                          String.fromCharCode(byte),
                        ).join(""),
                      )
                    : undefined;
                await operation.mutateAsync({ sandboxId, ...input, data });
              }}
            >
              <Field label="Path">
                <Input
                  name="path"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                />
              </Field>
              <Field label="Operation">
                <ChoiceSelect
                  name="op"
                  defaultValue="write"
                  options={[
                    { value: "write", label: "Save text file" },
                    { value: "mkdir", label: "Create directory" },
                    { value: "move", label: "Move or rename" },
                    {
                      value: "delete",
                      label: "Delete file or empty directory",
                    },
                  ]}
                />
              </Field>
              <Field label="Destination" hint="Only used for move or rename.">
                <Input name="destination" />
              </Field>
              <Field label="Text content">
                <Textarea
                  rows={12}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  spellCheck={false}
                />
              </Field>
            </ActionForm>
            <Button
              className="mt-4"
              variant="outline"
              disabled={collect.isPending}
              onClick={() =>
                collect.mutate({
                  sandboxId,
                  path,
                  filename: path.split("/").at(-1) || "file",
                })
              }
            >
              <Save />
              Save to Artifacts
            </Button>
          </TabsContent>
        )}
      </Tabs>
      <ErrorAlert error={operation.error} />
      {entries.success ? (
        <div className="divide-y border">
          {entries.data.entries.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              This directory is empty.
            </p>
          )}
          {entries.data.entries.map((entry) => (
            <Button
              key={entry.name}
              variant="ghost"
              className="flex w-full justify-start p-4"
              disabled={entry.symlink}
              onClick={() =>
                setPath(`${path === "." ? "" : `${path}/`}${entry.name}`)
              }
            >
              {entry.directory ? <Folder className="text-forest" /> : <File />}
              {entry.name}
            </Button>
          ))}
        </div>
      ) : (
        operation.data && (
          <pre className="output-panel">
            {content || display(operation.data)}
          </pre>
        )
      )}
    </div>
  );
}
