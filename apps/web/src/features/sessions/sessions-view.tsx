"use client";
import { useState } from "react";
import { Button, Input } from "@repo/ui";
import { ArrowUpRight, Trash2, MessagesSquare } from "lucide-react";
import {
  useSessions,
  useSession,
  useCreateSession,
  useDeleteSession,
  useUpdateSession,
  createSessionSchema,
} from "@repo/web/hooks/api/sessions";
import {
  ActionForm,
  CreateDialog,
  Field,
  ChoiceSelect,
} from "@repo/web/components/shared/forms";
import {
  ResourceTable,
  StatusBadge,
} from "@repo/web/components/shared/resource-table";
import { DetailSheet } from "@repo/web/components/shared/detail-sheet";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
import {
  ErrorAlert,
  LoadingCards,
  EmptyState,
} from "@repo/web/components/shared/feedback";
import type { Session } from "@repo/web/lib/schemas";
import { dateLabel, display } from "@repo/web/lib/format";
export function SessionsView({ writable }: { writable: boolean }) {
  const query = useSessions();
  const create = useCreateSession();
  const remove = useDeleteSession();
  const [selected, setSelected] = useState("");
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        {writable && (
          <CreateDialog
            title="Create session"
            description="Keep related tasks and conversation history in one place."
          >
            {(close) => (
              <ActionForm
                schema={createSessionSchema}
                pending={create.isPending}
                submit="Create session"
                onSubmit={async (input) => {
                  await create.mutateAsync(input);
                  close();
                }}
              >
                <SessionFields />
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
        emptyTitle="Start a conversation that lasts"
        emptyDescription="Create a session and attach agent runs to build on earlier work."
        columns={[
          {
            label: "Session",
            cell: (session) => (
              <div className="flex gap-3 font-medium">
                <MessagesSquare className="size-4 text-forest" />
                {session.title}
              </div>
            ),
          },
          {
            label: "Approvals",
            cell: (session) =>
              session.approvalType === "APPROVE_FOR_ME"
                ? "Approve for me"
                : "Ask for approval",
          },
          { label: "Created", cell: (session) => dateLabel(session.createdAt) },
        ]}
        actions={(session) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(session.id)}
            >
              Open
              <ArrowUpRight />
            </Button>
            {writable && <EditSession session={session} />}
            {writable && (
              <ConfirmAction
                title="Delete this session?"
                description="Conversation history will be removed. Associated runs remain available."
                action={() => remove.mutateAsync(session.id)}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${session.title}`}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </ConfirmAction>
            )}
          </>
        )}
      />
      <DetailSheet
        title="Conversation"
        description="Session messages and related agent runs."
        open={!!selected}
        close={() => setSelected("")}
      >
        {selected && <SessionDetail id={selected} />}
      </DetailSheet>
    </div>
  );
}
function SessionDetail({ id }: { id: string }) {
  const query = useSession(id);
  if (query.isPending) return <LoadingCards />;
  if (!query.data) return <ErrorAlert error={query.error} />;
  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold">{query.data.title}</h3>
      {query.data.messages?.length ? (
        query.data.messages.map((message) => (
          <article
            key={message.id}
            className={`conversation-message ${message.role === "user" ? "from-user" : ""}`}
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {message.role}
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {display(message.content)}
            </p>
          </article>
        ))
      ) : (
        <EmptyState
          title="A clean slate"
          description="Attach a new agent run to this session to start its history."
        />
      )}
      {query.data.runs?.map((run) => (
        <div
          key={run.id}
          className="flex items-center justify-between gap-3 border-t py-3"
        >
          <span className="truncate text-sm">{run.task}</span>
          <StatusBadge status={run.status} />
        </div>
      ))}
    </div>
  );
}

function SessionFields({ session }: { session?: Session }) {
  return (
    <>
      <Field label="Session name">
        <Input
          name="title"
          required
          maxLength={200}
          defaultValue={session?.title}
          placeholder="My next project"
        />
      </Field>
      <Field
        label="Tool approvals"
        hint="Approve for me lets agent runs perform permitted actions without asking. Tool permissions and execution limits still apply."
      >
        <ChoiceSelect
          name="approvalType"
          defaultValue={session?.approvalType ?? "ASK_FOR_APPROVAL"}
          options={[
            { value: "ASK_FOR_APPROVAL", label: "Ask for approval" },
            { value: "APPROVE_FOR_ME", label: "Approve for me" },
          ]}
        />
      </Field>
    </>
  );
}
function EditSession({ session }: { session: Session }) {
  const update = useUpdateSession();
  return (
    <CreateDialog
      title="Edit session"
      label="Edit"
      description="Update the session name and approval setting. Changes apply to subsequent tool checks; pending approvals still need a decision."
    >
      {(close) => (
        <ActionForm
          schema={createSessionSchema}
          pending={update.isPending}
          submit="Save changes"
          onSubmit={async (input) => {
            await update.mutateAsync({ id: session.id, ...input });
            close();
          }}
        >
          <SessionFields session={session} />
        </ActionForm>
      )}
    </CreateDialog>
  );
}
