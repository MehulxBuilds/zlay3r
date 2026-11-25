"use client";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Progress,
  Badge,
} from "@repo/ui";
import { Check, X } from "lucide-react";
import {
  useApprovals,
  useDecideApproval,
  useUsage,
  useAudit,
  useActivity,
} from "@repo/web/hooks/api/governance";
import {
  ErrorAlert,
  EmptyState,
  LoadingCards,
  StatCard,
} from "@repo/web/components/shared/feedback";
import {
  ResourceTable,
  StatusBadge,
} from "@repo/web/components/shared/resource-table";
import {
  dateLabel,
  display,
  numberLabel,
  bytesLabel,
} from "@repo/web/lib/format";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
export function ApprovalsView({ admin }: { admin: boolean }) {
  const query = useApprovals();
  const decide = useDecideApproval();
  if (query.isPending) return <LoadingCards />;
  return (
    <div className="space-y-5">
      <ErrorAlert error={query.error} retry={() => void query.refetch()} />
      {query.data?.length ? (
        query.data.map((approval) => (
          <Card key={approval.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Action review</CardTitle>
                <StatusBadge status={approval.status} />
              </div>
              <CardDescription>
                Expires {dateLabel(approval.expiresAt)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="output-panel">{display(approval.action)}</pre>
              {admin &&
                approval.status === "PENDING" &&
                new Date(approval.expiresAt) > new Date() && (
                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({ id: approval.id, approve: false })
                      }
                    >
                      <X />
                      Reject
                    </Button>
                    <ConfirmAction
                      destructive={false}
                      title="Approve this action?"
                      description="This grants a one-use approval. Check the command and its arguments before continuing."
                      action={() =>
                        decide.mutateAsync({ id: approval.id, approve: true })
                      }
                    >
                      <Button>
                        <Check />
                        Approve action
                      </Button>
                    </ConfirmAction>
                  </div>
                )}
            </CardContent>
          </Card>
        ))
      ) : (
        <Card>
          <EmptyState
            title="Nothing waiting on you"
            description="When an agent requests a sensitive action, you'll be able to review it here."
          />
        </Card>
      )}
    </div>
  );
}
export function UsageView() {
  const query = useUsage();
  if (query.isPending) return <LoadingCards />;
  if (!query.data)
    return (
      <ErrorAlert error={query.error} retry={() => void query.refetch()} />
    );
  const usage = query.data;
  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard
          label="Model tokens"
          value={numberLabel(
            usage.totals.find((item) => item.metric === "tokens")?.quantity ??
              0,
          )}
          hint="Recorded this month"
        />
        <StatCard
          label="Agent runs"
          value={numberLabel(
            usage.totals.find((item) => item.metric === "runs")?.quantity ?? 0,
          )}
          hint="Recorded this month"
        />
        <StatCard
          label="Artifact storage"
          value={bytesLabel(usage.storage?.bytes ?? 0)}
          hint={`${usage.storage?.count ?? 0} saved files`}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Workspace limits</CardTitle>
          <CardDescription>
            Usage and active reservations against your configured quotas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {usage.quotas.length ? (
            usage.quotas.map((quota) => {
              const quantity =
                quota.metric === "artifact_bytes"
                  ? (usage.storage?.bytes ?? 0)
                  : (usage.totals.find((item) => item.metric === quota.metric)
                      ?.quantity ?? 0);
              const reserved =
                usage.reservations.find((item) => item.metric === quota.metric)
                  ?.quantity ?? 0;
              return (
                <div key={quota.metric}>
                  <div className="mb-2 flex justify-between gap-3 text-sm">
                    <span className="capitalize">
                      {quota.metric.replaceAll("_", " ")}
                    </span>
                    <span className="text-muted-foreground">
                      {numberLabel(quantity)} / {numberLabel(quota.limit)}
                    </span>
                  </div>
                  <Progress
                    value={
                      quota.limit > 0
                        ? Math.min(
                            100,
                            ((quantity + reserved) / quota.limit) * 100,
                          )
                        : 0
                    }
                  />
                  {reserved > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {numberLabel(reserved)} reserved for active work
                    </p>
                  )}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              No quotas configured. Workspace admins can add limits in Settings.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Model consumption</CardTitle>
          <CardDescription>
            Provider-reported usage and configured cost estimates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {usage.models.length ? (
            usage.models.map((item) => (
              <div
                key={`${item.provider}-${item.model}-${item.metric}`}
                className="flex flex-wrap items-center justify-between gap-2 border-b py-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {item.model ?? "Unknown model"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.provider} {"\u00b7"}{" "}
                    {item.metric.replaceAll("_", " ")}
                  </p>
                </div>
                <Badge variant="outline">{numberLabel(item.quantity)}</Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Model usage will appear after your first run.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
export function AuditView() {
  const query = useAudit();
  return (
    <ResourceTable
      rows={query.data?.pages.flatMap((page) => page.items) ?? []}
      loading={query.isPending}
      error={query.error}
      retry={() => void query.refetch()}
      more={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onMore={() => void query.fetchNextPage()}
      emptyTitle="A clear record starts here"
      emptyDescription="Workspace changes will be recorded as your team builds."
      columns={[
        { label: "Action", cell: (item) => item.action },
        { label: "Actor", cell: (item) => item.actorId.slice(0, 8) },
        {
          label: "Resource",
          cell: (item) => item.resourceId?.slice(0, 8) ?? "\u2014",
        },
        { label: "When", cell: (item) => dateLabel(item.createdAt) },
      ]}
    />
  );
}
export function ActivityView() {
  const query = useActivity();
  return (
    <ResourceTable
      rows={query.data?.pages.flatMap((page) => page.items) ?? []}
      loading={query.isPending}
      error={query.error}
      retry={() => void query.refetch()}
      more={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onMore={() => void query.fetchNextPage()}
      emptyTitle="Your workspace is warming up"
      emptyDescription="Sandbox and artifact activity will appear here."
      columns={[
        { label: "Event", cell: (item) => item.type.replaceAll(".", "\u00b7") },
        { label: "Resource", cell: (item) => item.resourceId.slice(0, 8) },
        { label: "When", cell: (item) => dateLabel(item.createdAt) },
      ]}
    />
  );
}
