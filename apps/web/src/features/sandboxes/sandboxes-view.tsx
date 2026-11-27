"use client";
import { useState } from "react";
import {
  Button,
  Input,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui";
import {
  ArrowUpRight,
  MoreHorizontal,
  Play,
  Pause,
  Square,
  RotateCw,
  Trash2,
  Box,
} from "lucide-react";
import {
  useSandboxes,
  useCreateSandbox,
  useSandboxLifecycle,
  useDestroySandbox,
  createSandboxSchema,
} from "@repo/web/hooks/api/sandboxes";
import type { Sandbox } from "@repo/web/lib/schemas";
import { bytesLabel, dateLabel } from "@repo/web/lib/format";
import {
  ResourceTable,
  StatusBadge,
} from "@repo/web/components/shared/resource-table";
import {
  ActionForm,
  CreateDialog,
  Field,
  ChoiceSelect,
} from "@repo/web/components/shared/forms";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
import { DetailSheet } from "@repo/web/components/shared/detail-sheet";
import { FileExplorer } from "./file-explorer";
export function SandboxesView({ writable }: { writable: boolean }) {
  const query = useSandboxes();
  const create = useCreateSandbox();
  const lifecycle = useSandboxLifecycle();
  const destroy = useDestroySandbox();
  const [sandboxType, setSandboxType] = useState<"KATA" | "FIRECRACKER">(
    "KATA",
  );
  const [selected, setSelected] = useState<Sandbox | null>(null);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Each sandbox has its own isolated environment, files, and resource
          limits.
        </p>
        {writable && (
          <CreateDialog
            title="Create sandbox"
            description="Make a fresh, isolated workspace for code and agents."
          >
            {(close) => (
              <ActionForm
                schema={createSandboxSchema}
                pending={create.isPending}
                submit="Create sandbox"
                onSubmit={async (input) => {
                  await create.mutateAsync(input);
                  close();
                }}
              >
                <Field label="Sandbox type">
                  <select
                    name="type"
                    value={sandboxType}
                    onChange={(event) =>
                      setSandboxType(
                        event.target.value as "KATA" | "FIRECRACKER",
                      )
                    }
                    className="h-10 w-full border bg-[#FFFDF6] px-3 text-sm"
                  >
                    <option value="KATA">Kata (Docker)</option>
                    <option value="FIRECRACKER">Firecracker</option>
                  </select>
                </Field>
                <Field label="Name">
                  <Input
                    name="name"
                    defaultValue="my-sandbox"
                    required
                    maxLength={40}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Memory">
                    <ChoiceSelect
                      name="memoryMb"
                      defaultValue="512"
                      options={[512, 1024, 2048].map((value) => ({
                        value: String(value),
                        label: `${value} MB`,
                      }))}
                    />
                  </Field>
                  <Field label="CPU cores">
                    <ChoiceSelect
                      key={sandboxType}
                      name="cpu"
                      defaultValue="1"
                      options={(sandboxType === "FIRECRACKER"
                        ? [1, 2]
                        : [0.25, 0.5, 1, 2]
                      ).map((value) => ({
                        value: String(value),
                        label: String(value),
                      }))}
                    />
                  </Field>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Workspace files are temporary. Save anything you want to keep
                  in Artifacts before destroying a sandbox.
                </p>
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
        emptyTitle="A fresh space for your next idea"
        emptyDescription="Create your first sandbox to run code, explore files, and give agents a place to work."
        columns={[
          {
            label: "Sandbox",
            cell: (box) => (
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center border bg-primary/10">
                  <Box className="size-4 text-forest" />
                </span>
                <div>
                  <p className="font-medium">{box.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {box.id.slice(0, 8)}
                  </p>
                </div>
              </div>
            ),
          },
          {
            label: "Type",
            cell: (box) =>
              box.type === "FIRECRACKER" ? "Firecracker" : "Kata",
          },
          {
            label: "Status",
            cell: (box) => <StatusBadge status={box.status} />,
          },
          {
            label: "Resources",
            cell: (box) => (
              <span className="text-muted-foreground">
                {bytesLabel(box.memoryMb * 1048576)} {"\u00b7"} {box.cpu} CPU
              </span>
            ),
          },
          { label: "Created", cell: (box) => dateLabel(box.createdAt) },
        ]}
        actions={(box) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={box.status !== "RUNNING"}
              onClick={() => setSelected(box)}
            >
              Open
              <ArrowUpRight />
            </Button>
            {writable && box.status !== "DESTROYED" && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for ${box.name}`}
                      disabled={lifecycle.isPending}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(box.status === "RUNNING"
                      ? [
                          {
                            action: "pause" as const,
                            label: "Pause",
                            icon: Pause,
                          },
                          {
                            action: "stop" as const,
                            label: "Stop",
                            icon: Square,
                          },
                          {
                            action: "restart" as const,
                            label: "Restart",
                            icon: RotateCw,
                          },
                        ]
                      : box.status === "PAUSED"
                        ? [
                            {
                              action: "resume" as const,
                              label: "Resume",
                              icon: Play,
                            },
                          ]
                        : box.status === "STOPPED"
                          ? [
                              {
                                action: "start" as const,
                                label: "Start",
                                icon: Play,
                              },
                            ]
                          : []
                    ).map((item) => (
                      <DropdownMenuItem
                        key={item.action}
                        onSelect={() =>
                          lifecycle.mutate({ id: box.id, action: item.action })
                        }
                      >
                        <item.icon />
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <ConfirmAction
                  title={`Destroy ${box.name}?`}
                  description="The sandbox and its workspace files will be removed. Saved artifacts stay available."
                  action={() => destroy.mutateAsync(box.id)}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Destroy ${box.name}`}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </ConfirmAction>
              </>
            )}
          </>
        )}
      />
      <DetailSheet
        title={selected?.name ?? "Sandbox"}
        description="Files and workspace operations"
        open={!!selected}
        close={() => setSelected(null)}
      >
        {selected && (
          <FileExplorer sandboxId={selected.id} writable={writable} />
        )}
      </DetailSheet>
    </div>
  );
}
