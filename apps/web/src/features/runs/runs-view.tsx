"use client";
import { useState } from "react";
import { Button, Input, Textarea } from "@repo/ui";
import { ArrowUpRight, Bot } from "lucide-react";
import {
  useRuns,
  useCreateRun,
  createRunSchema,
} from "@repo/web/hooks/api/runs";
import { dateLabel } from "@repo/web/lib/format";
import {
  ActionForm,
  CreateDialog,
  Field,
  ChoiceSelect,
} from "@repo/web/components/shared/forms";
import {
  SandboxSelect,
  SessionSelect,
} from "@repo/web/components/shared/resource-select";
import {
  ResourceTable,
  StatusBadge,
} from "@repo/web/components/shared/resource-table";
import { DetailSheet } from "@repo/web/components/shared/detail-sheet";
import { RunDetail } from "./run-detail";
export function RunsView({ writable }: { writable: boolean }) {
  const query = useRuns();
  const create = useCreateRun();
  const [selectedId, setSelectedId] = useState("");
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        {writable && (
          <CreateDialog
            title="Start an agent run"
            description="Choose a workspace and tell your agent what you'd like to do."
            label="New agent run"
          >
            {(close) => (
              <ActionForm
                schema={createRunSchema}
                pending={create.isPending}
                submit="Start agent"
                onSubmit={async (input) => {
                  const run = await create.mutateAsync(input);
                  close();
                  setSelectedId(run.id);
                }}
              >
                <Field label="Sandbox">
                  <SandboxSelect />
                </Field>
                <Field label="Task">
                  <Textarea
                    name="task"
                    rows={4}
                    required
                    placeholder="Explore the workspace and explain what you find..."
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Provider">
                    <ChoiceSelect
                      name="provider"
                      defaultValue="openai"
                      options={[
                        "openai",
                        "anthropic",
                        "deepseek",
                        "openrouter",
                      ].map((value) => ({
                        value,
                        label:
                          value === "openai"
                            ? "OpenAI"
                            : value === "openrouter"
                              ? "OpenRouter"
                              : value === "deepseek"
                                ? "DeepSeek"
                                : "Anthropic",
                      }))}
                    />
                  </Field>
                  <Field
                    label="Model"
                    hint="Optional. Uses your provider default."
                  >
                    <Input name="model" placeholder="Provider default" />
                  </Field>
                </div>
                <Field
                  label="Session"
                  hint="Optional. Keep conversation history together."
                >
                  <SessionSelect />
                </Field>
                <Field
                  label="System instructions"
                  hint="Optional guidance for this run."
                >
                  <Textarea name="systemInstructions" rows={2} />
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
        emptyTitle="Ready when you are"
        emptyDescription="Start an agent run to turn a task into a sequence of real actions."
        columns={[
          {
            label: "Task",
            cell: (run) => (
              <div className="flex items-center gap-3">
                <Bot className="size-4 shrink-0 text-forest" />
                <span className="font-medium">{run.task}</span>
              </div>
            ),
          },
          {
            label: "Status",
            cell: (run) => <StatusBadge status={run.status} />,
          },
          { label: "Provider", cell: (run) => run.provider },
          { label: "Created", cell: (run) => dateLabel(run.createdAt) },
        ]}
        actions={(run) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedId(run.id)}
          >
            View run
            <ArrowUpRight />
          </Button>
        )}
      />
      <DetailSheet
        title="Agent run"
        description="Follow the task, output and execution timeline."
        open={!!selectedId}
        close={() => setSelectedId("")}
      >
        {selectedId && <RunDetail id={selectedId} writable={writable} />}
      </DetailSheet>
    </div>
  );
}
