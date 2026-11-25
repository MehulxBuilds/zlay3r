"use client";
import { useState } from "react";
import { Button, Input, Textarea } from "@repo/ui";
import { ArrowUpRight, Square, Terminal } from "lucide-react";
import {
  useExecutions,
  useExecution,
  useCreateExecution,
  useCancelExecution,
  createExecutionSchema,
} from "@repo/web/hooks/api/executions";
import {
  ActionForm,
  CreateDialog,
  Field,
  TagInput,
} from "@repo/web/components/shared/forms";
import { SandboxSelect } from "@repo/web/components/shared/resource-select";
import {
  ResourceTable,
  StatusBadge,
} from "@repo/web/components/shared/resource-table";
import { DetailSheet } from "@repo/web/components/shared/detail-sheet";
import { ErrorAlert, LoadingCards } from "@repo/web/components/shared/feedback";
import { dateLabel } from "@repo/web/lib/format";
export function ExecutionsView({ writable }: { writable: boolean }) {
  const query = useExecutions();
  const create = useCreateExecution();
  const cancel = useCancelExecution();
  const [selected, setSelected] = useState("");
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        {writable && (
          <CreateDialog
            title="Run a command"
            description="Execute a bounded shell command inside your sandbox."
          >
            {(close) => (
              <ActionForm
                schema={createExecutionSchema}
                pending={create.isPending}
                submit="Run command"
                onSubmit={async (input) => {
                  const execution = await create.mutateAsync(input);
                  close();
                  setSelected(execution.id);
                }}
              >
                <Field label="Sandbox">
                  <SandboxSelect />
                </Field>
                <Field label="Command">
                  <Textarea
                    name="command"
                    required
                    placeholder="ls -la"
                    rows={3}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Working directory">
                    <Input name="cwd" defaultValue="." />
                  </Field>
                  <Field label="Timeout (milliseconds)">
                    <Input
                      name="timeoutMs"
                      type="number"
                      defaultValue={30000}
                      min={100}
                      max={300000}
                    />
                  </Field>
                </div>
                <Field
                  label="Secret references"
                  hint="Optional. Add existing secret names individually."
                >
                  <TagInput name="secretNames" placeholder="SERVICE_TOKEN" />
                </Field>
              </ActionForm>
            )}
          </CreateDialog>
        )}
      </div>
      <ResourceTable
        rows={query.data?.pages.flatMap((page) => page.items) ?? []}
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
        more={query.hasNextPage}
        loadingMore={query.isFetchingNextPage}
        onMore={() => void query.fetchNextPage()}
        emptyTitle="Make your first move"
        emptyDescription="Run a command in a sandbox to inspect files, execute scripts, or build something."
        columns={[
          {
            label: "Command",
            cell: (execution) => (
              <div className="flex gap-3 font-medium">
                <Terminal className="size-4 shrink-0 text-forest" />
                {execution.command}
              </div>
            ),
          },
          {
            label: "Status",
            cell: (execution) => <StatusBadge status={execution.status} />,
          },
          {
            label: "Created",
            cell: (execution) => dateLabel(execution.createdAt),
          },
        ]}
        actions={(execution) => (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(execution.id)}
            >
              Output
              <ArrowUpRight />
            </Button>
            {writable && ["QUEUED", "RUNNING"].includes(execution.status) && (
              <Button
                variant="ghost"
                size="icon"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(execution.id)}
                aria-label="Cancel command"
              >
                <Square className="size-4" />
              </Button>
            )}
          </>
        )}
      />
      <DetailSheet
        title="Command output"
        description="The command, its exit code and captured output."
        open={!!selected}
        close={() => setSelected("")}
      >
        {selected && <ExecutionDetail id={selected} />}
      </DetailSheet>
    </div>
  );
}
function ExecutionDetail({ id }: { id: string }) {
  const query = useExecution(id);
  if (query.isPending) return <LoadingCards />;
  if (!query.data) return <ErrorAlert error={query.error} />;
  const execution = query.data;
  return (
    <div className="space-y-5">
      <StatusBadge status={execution.status} />
      <pre className="output-panel">{execution.command}</pre>
      {execution.result ? (
        <>
          <p className="text-sm text-muted-foreground">
            Exit code: {execution.result.exitCode ?? "Unknown"}
            {execution.result.timedOut ? " - Time limit reached" : ""}
          </p>
          <div>
            <h3 className="mb-2 text-sm font-medium">Standard output</h3>
            <pre className="output-panel">
              {execution.result.stdout || "No output"}
            </pre>
          </div>
          {execution.result.stderr && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Standard error</h3>
              <pre className="output-panel">{execution.result.stderr}</pre>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Output will appear when the command completes.
        </p>
      )}
    </div>
  );
}
