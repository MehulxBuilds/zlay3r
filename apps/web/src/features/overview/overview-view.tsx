"use client";
import { ArrowRight, Bot, Box, Files, Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@repo/ui";
import { useSandboxes } from "@repo/web/hooks/api/sandboxes";
import { useRuns } from "@repo/web/hooks/api/runs";
import { useUsage } from "@repo/web/hooks/api/governance";
import { useWorkspaceStore } from "@repo/web/stores/workspace-store";
import {
  PixelCard,
  StatCard,
  ErrorAlert,
  EmptyState,
  LoadingCards,
} from "@repo/web/components/shared/feedback";
import { StatusBadge } from "@repo/web/components/shared/resource-table";
import { bytesLabel, dateLabel } from "@repo/web/lib/format";
export function OverviewView({ writable }: { writable: boolean }) {
  const sandboxes = useSandboxes();
  const runs = useRuns();
  const usage = useUsage();
  const navigate = useWorkspaceStore((state) => state.navigate);
  if (sandboxes.isPending || runs.isPending || usage.isPending)
    return <LoadingCards />;
  const boxes = sandboxes.data?.pages.flatMap((page) => page.items) ?? [];
  const recentRuns = runs.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="space-y-7">
      <PixelCard className="overview-hero">
        <CardContent className="flex flex-wrap items-center justify-between gap-8">
          <div className="max-w-xl">
            <Badge className="mb-5 bg-pink text-foreground hover:bg-pink">
              MADE FOR YOUR NEXT IDEA
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Room to think.
              <br />
              Space to build.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
              From a fresh sandbox to an agent that gets things done. Your next
              project starts with one small step.
            </p>
            {writable && (
              <Button className="mt-6" onClick={() => navigate("sandboxes")}>
                Open your sandboxes
                <ArrowRight />
              </Button>
            )}
          </div>
          <div className="hero-pixels" aria-hidden="true">
            <div className="hero-pixel-box">
              <Box />
            </div>
            <div className="hero-pixel-bot">
              <Bot />
            </div>
            <span className="hero-spark">
              <Sparkles />
            </span>
          </div>
        </CardContent>
      </PixelCard>
      <ErrorAlert error={sandboxes.error ?? runs.error ?? usage.error} />
      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard
          label="Running sandboxes"
          value={boxes.filter((box) => box.status === "RUNNING").length}
          hint="In your loaded workspaces"
        />
        <StatCard
          label="Active agent runs"
          value={
            recentRuns.filter((run) =>
              ["RUNNING", "QUEUED"].includes(run.status),
            ).length
          }
          hint="In your recent runs"
        />
        <StatCard
          label="Files worth keeping"
          value={usage.data?.storage?.count ?? 0}
          hint={`${bytesLabel(usage.data?.storage?.bytes ?? 0)} in private storage`}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent agent runs</CardTitle>
              <Button
                variant="link"
                className="text-forest"
                onClick={() => navigate("runs")}
              >
                View all
                <ArrowRight />
              </Button>
            </div>
            <CardDescription>
              A little progress, one task at a time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentRuns.length ? (
              recentRuns.slice(0, 5).map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b py-4 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{run.task}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dateLabel(run.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={run.status} />
                </div>
              ))
            ) : (
              <EmptyState
                title="Your first run is waiting"
                description="Give an agent a task and watch its progress here."
              />
            )}
          </CardContent>
        </Card>
        <Card className="bg-primary/10">
          <CardHeader>
            <span className="mb-2 grid size-10 place-items-center border border-primary bg-background">
              <Files className="size-5 text-forest" />
            </span>
            <CardTitle>Make it yours.</CardTitle>
            <CardDescription className="leading-relaxed">
              Connect your models, set your policies, and invite your team. A
              few small steps go a long way.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate("providers")}>
              Explore model providers
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
