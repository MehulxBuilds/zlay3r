"use client";
import { Button } from "@repo/ui";
import { useSandboxes } from "@repo/web/hooks/api/sandboxes";
import { useSessions } from "@repo/web/hooks/api/sessions";
import { ChoiceSelect } from "./forms";
import { ErrorAlert } from "./feedback";
export function SandboxSelect({
  name = "sandboxId",
  id,
}: {
  name?: string;
  id?: string;
}) {
  const query = useSandboxes();
  const items =
    query.data?.pages
      .flatMap((page) => page.items)
      .filter((box) => box.status === "RUNNING") ?? [];
  return (
    <div className="space-y-2">
      <ChoiceSelect
        id={id}
        name={name}
        disabled={query.isPending}
        placeholder={
          query.isPending ? "Loading sandboxes..." : "Choose a running sandbox"
        }
        options={items.map((box) => ({ value: box.id, label: box.name }))}
      />
      <ErrorAlert error={query.error} />
      {!query.isPending && !items.length && (
        <p className="text-xs text-muted-foreground">
          Create or start a sandbox in Sandboxes first.
        </p>
      )}
      {query.hasNextPage && (
        <Button
          type="button"
          variant="link"
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more sandboxes
        </Button>
      )}
    </div>
  );
}
export function SessionSelect({ id }: { id?: string }) {
  const query = useSessions();
  return (
    <div className="space-y-2">
      <ChoiceSelect
        id={id}
        optional
        name="sessionId"
        placeholder="Start without a session"
        options={
          query.data?.pages
            .flatMap((page) => page.items)
            .map((item) => ({ value: item.id, label: item.title })) ?? []
        }
      />
      {query.hasNextPage && (
        <Button
          type="button"
          variant="link"
          onClick={() => void query.fetchNextPage()}
        >
          Load more sessions
        </Button>
      )}
    </div>
  );
}
