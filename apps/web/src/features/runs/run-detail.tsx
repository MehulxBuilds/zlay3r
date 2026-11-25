"use client";
import { z } from "zod";
import { Alert, AlertDescription, Badge, Button, Separator } from "@repo/ui";
import { Download, History, Play, Square } from "lucide-react";
import {
  useRun,
  useRunEvents,
  useCancelRun,
  useResumeRun,
  useReplayRun,
  useExportCheckpoint,
} from "@repo/web/hooks/api/runs";
import { ErrorAlert, LoadingCards } from "@repo/web/components/shared/feedback";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
import { StatusBadge } from "@repo/web/components/shared/resource-table";
import { display } from "@repo/web/lib/format";
export function RunDetail({ id, writable }: { id: string; writable: boolean }) {
  const query = useRun(id);
  const stream = useRunEvents(id);
  const cancel = useCancelRun();
  const resume = useResumeRun();
  const replay = useReplayRun();
  const checkpoint = useExportCheckpoint();
  if (query.isPending) return <LoadingCards />;
  if (!query.data)
    return (
      <ErrorAlert error={query.error} retry={() => void query.refetch()} />
    );
  const run = query.data;
  const events = stream.data?.length ? stream.data : (run.events ?? []);
  const liveText = events
    .filter((event) => event.type === "model.delta")
    .map((event) => {
      const parsed = z.object({ text: z.string() }).safeParse(event.payload);
      return parsed.success ? parsed.data.text : "";
    })
    .join("");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.status} />
        <Badge variant="secondary">{run.provider ?? "Model provider"}</Badge>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground">Task</h3>
        <p className="mt-2 whitespace-pre-wrap leading-relaxed">{run.task}</p>
      </div>
      {run.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {run.error.replaceAll("_", " ").toLowerCase()}
          </AlertDescription>
        </Alert>
      )}
      {(run.result?.finalAnswer || liveText) && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">
            {run.result ? "Final response" : "Agent response"}
          </h3>
          <pre className="output-panel whitespace-pre-wrap">
            {run.result?.finalAnswer ?? liveText}
          </pre>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {writable &&
          ["QUEUED", "RUNNING", "AWAITING_APPROVAL"].includes(run.status) && (
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(id)}
            >
              <Square />
              Cancel run
            </Button>
          )}
        {writable &&
          ["INTERRUPTED", "FAILED", "AWAITING_APPROVAL"].includes(
            run.status,
          ) && (
            <ConfirmAction
              destructive={false}
              title="Resume this run?"
              description="A previous action may have already changed external state. Resuming continues from the saved checkpoint and may repeat an uncertain action."
              action={() => resume.mutateAsync(id)}
            >
              <Button>
                <Play />
                Resume run
              </Button>
            </ConfirmAction>
          )}
        <Button
          variant="outline"
          disabled={replay.isPending}
          onClick={() => replay.mutate(id)}
        >
          <History />
          Replay history
        </Button>
        {writable && (
          <Button
            variant="outline"
            disabled={checkpoint.isPending}
            onClick={() => checkpoint.mutate(id)}
          >
            <Download />
            Export checkpoint
          </Button>
        )}
      </div>
      {replay.data && (
        <Alert>
          <AlertDescription>
            Reconstructed status:{" "}
            {replay.data.reconstructedStatus.toLowerCase()}. No actions were
            executed.
          </AlertDescription>
        </Alert>
      )}
      <Separator />
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Execution timeline</h3>
          <Badge variant="outline">{events.length} events</Badge>
        </div>
        <div className="timeline">
          {events
            .filter((event) => event.type !== "model.delta")
            .map((event) => (
              <details key={event.id} className="timeline-event">
                <summary className="cursor-pointer text-sm">
                  <span className="mr-3 text-xs text-muted-foreground">
                    {String(event.sequence).padStart(2, "0")}
                  </span>
                  {event.type.replaceAll(".", "\u00b7").replaceAll("_", " ")}
                </summary>
                <pre className="output-panel mt-3">
                  {display(event.payload)}
                </pre>
              </details>
            ))}
          {!events.length && (
            <p className="text-sm text-muted-foreground">
              Events will appear as your agent gets to work.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
