"use client";
import { useState } from "react";
import { z } from "zod";
import { Alert, AlertDescription, Button, Input, Textarea } from "@repo/ui";
import { ArrowUpRight, Globe, X } from "lucide-react";
import {
  useBrowsers,
  useCreateBrowser,
  useBrowserAction,
  useCloseBrowser,
  browserActionSchema,
} from "@repo/web/hooks/api/browsers";
import {
  ResourceTable,
  StatusBadge,
} from "@repo/web/components/shared/resource-table";
import {
  ActionForm,
  CreateDialog,
  Field,
} from "@repo/web/components/shared/forms";
import { SandboxSelect } from "@repo/web/components/shared/resource-select";
import { DetailSheet } from "@repo/web/components/shared/detail-sheet";
import { dateLabel, display } from "@repo/web/lib/format";
import { artifactSchema } from "@repo/web/lib/schemas";
export function BrowsersView({ writable }: { writable: boolean }) {
  const query = useBrowsers();
  const create = useCreateBrowser();
  const closeBrowser = useCloseBrowser();
  const [selected, setSelected] = useState("");
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        {writable && (
          <CreateDialog
            title="Open a browser"
            description="Explore approved websites in an isolated browser session."
          >
            {(close) => (
              <ActionForm
                schema={z.object({
                  sandboxId: z.string().min(1, "Choose a sandbox"),
                })}
                pending={create.isPending}
                submit="Open browser"
                onSubmit={async (input) => {
                  const browser = await create.mutateAsync(input);
                  close();
                  setSelected(browser.id);
                }}
              >
                <Field label="Sandbox">
                  <SandboxSelect />
                </Field>
                <Alert>
                  <AlertDescription>
                    Browser tools and destination hosts must be allowed in your
                    workspace policy.
                  </AlertDescription>
                </Alert>
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
        emptyTitle="A window into the web"
        emptyDescription="Open a browser inside a running sandbox to navigate, inspect, and collect screenshots."
        columns={[
          {
            label: "Browser",
            cell: (browser) => (
              <div className="flex gap-3 font-medium">
                <Globe className="size-4 text-forest" />
                Session {browser.id.slice(0, 8)}
              </div>
            ),
          },
          {
            label: "Status",
            cell: (browser) => <StatusBadge status={browser.status} />,
          },
          { label: "Created", cell: (browser) => dateLabel(browser.createdAt) },
        ]}
        actions={(browser) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={browser.status !== "OPEN"}
              onClick={() => setSelected(browser.id)}
            >
              Open
              <ArrowUpRight />
            </Button>
            {writable && browser.status === "OPEN" && (
              <Button
                variant="ghost"
                size="icon"
                disabled={closeBrowser.isPending}
                aria-label="Close browser"
                onClick={() => closeBrowser.mutate(browser.id)}
              >
                <X className="size-4" />
              </Button>
            )}
          </>
        )}
      />
      <DetailSheet
        title="Browser workspace"
        description="Interact with your isolated browser."
        open={!!selected}
        close={() => setSelected("")}
      >
        {selected && <BrowserControls id={selected} writable={writable} />}
      </DetailSheet>
    </div>
  );
}
function BrowserControls({ id, writable }: { id: string; writable: boolean }) {
  const mutation = useBrowserAction();
  const [action, setAction] = useState("inspect");
  const artifact = artifactSchema.safeParse(mutation.data);
  const page = z
    .object({
      url: z.string().optional(),
      title: z.string().optional(),
      text: z.string().optional(),
    })
    .safeParse(mutation.data);
  return (
    <div className="space-y-6">
      <Field label="Action">
        <ChoiceSelectControl
          value={action}
          onChange={setAction}
          writable={writable}
        />
      </Field>
      <ActionForm
        key={action}
        schema={browserActionSchema}
        pending={mutation.isPending}
        submit={action === "inspect" ? "Inspect page" : "Run action"}
        onSubmit={async (input) => {
          await mutation.mutateAsync({ id, action: input });
        }}
      >
        <input type="hidden" name="action" value={action} />
        {action === "navigate" && (
          <Field label="Website URL">
            <Input
              name="url"
              type="url"
              required
              placeholder="https://allowed.example.com"
            />
          </Field>
        )}
        {["click", "type", "download"].includes(action) && (
          <Field
            label="Element selector"
            hint="A selector such as button[type=submit] or #search."
          >
            <Input name="selector" required />
          </Field>
        )}
        {action === "type" && (
          <Field label="Text to enter">
            <Textarea name="text" />
          </Field>
        )}
        {action === "scroll" && (
          <Field label="Scroll distance (pixels)">
            <Input
              name="y"
              type="number"
              defaultValue={600}
              min={-10000}
              max={10000}
            />
          </Field>
        )}
        {action === "persist" && (
          <p className="text-sm text-muted-foreground">
            Save encrypted browser cookies and session state for later
            restoration.
          </p>
        )}
        {action === "restore" && (
          <p className="text-sm text-muted-foreground">
            Replace the current browser context with its previously saved state.
          </p>
        )}
      </ActionForm>
      {artifact.success ? (
        <Alert>
          <AlertDescription>
            Saved {artifact.data.filename} to Artifacts.
          </AlertDescription>
        </Alert>
      ) : (
        mutation.data && (
          <div className="space-y-3">
            {page.success && (page.data.title || page.data.url) && (
              <>
                <h3 className="font-semibold">{page.data.title}</h3>
                <p className="break-all text-xs text-muted-foreground">
                  {page.data.url}
                </p>
              </>
            )}
            <pre className="output-panel">
              {page.success && page.data.text
                ? page.data.text
                : display(mutation.data)}
            </pre>
          </div>
        )
      )}
    </div>
  );
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";
function ChoiceSelectControl({
  id,
  value,
  onChange,
  writable,
}: {
  id?: string;
  value: string;
  onChange(value: string): void;
  writable: boolean;
}) {
  const actions = writable
    ? [
        "inspect",
        "navigate",
        "click",
        "type",
        "scroll",
        "screenshot",
        "download",
        "persist",
        "restore",
      ]
    : ["inspect"];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {actions.map((action) => (
          <SelectItem key={action} value={action}>
            {
              {
                inspect: "Inspect page",
                navigate: "Navigate to website",
                click: "Click element",
                type: "Type text",
                scroll: "Scroll page",
                screenshot: "Save screenshot",
                download: "Collect download",
                persist: "Save browser state",
                restore: "Restore browser state",
              }[action]
            }
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
