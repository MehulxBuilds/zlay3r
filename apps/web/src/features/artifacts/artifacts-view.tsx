"use client";
import { useState } from "react";
import { z } from "zod";
import { Alert, AlertDescription, Button, Input } from "@repo/ui";
import { Download, FileImage, FileText, Trash2 } from "lucide-react";
import {
  useArtifacts,
  useUploadArtifact,
  useDownloadArtifact,
  useRemoveArtifact,
} from "@repo/web/hooks/api/artifacts";
import {
  ResourceTable,
  StatusBadge,
} from "@repo/web/components/shared/resource-table";
import {
  ActionForm,
  CreateDialog,
  Field,
} from "@repo/web/components/shared/forms";
import { DetailSheet } from "@repo/web/components/shared/detail-sheet";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
import { dateLabel, bytesLabel } from "@repo/web/lib/format";
export function ArtifactsView({ writable }: { writable: boolean }) {
  const query = useArtifacts();
  const upload = useUploadArtifact();
  const download = useDownloadArtifact();
  const remove = useRemoveArtifact();
  const [preview, setPreview] = useState<{
    filename: string;
    mimeType: string;
    url: string;
  } | null>(null);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Keep the things worth keeping. Private files, up to 8 MB each.
        </p>
        {writable && (
          <CreateDialog
            title="Upload a file"
            description="Save a file to your workspace's private artifact storage."
          >
            {(close) => (
              <ActionForm
                schema={z.object({
                  file: z
                    .file()
                    .max(8 * 1048576, "Choose a file smaller than 8 MB"),
                })}
                pending={upload.isPending}
                submit="Upload file"
                onSubmit={async (input) => {
                  await upload.mutateAsync(input.file);
                  close();
                }}
              >
                <Field label="File">
                  <Input name="file" type="file" required />
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
        emptyTitle="Good things will land here"
        emptyDescription="Collect agent outputs, save screenshots, or upload a file to keep it in your workspace."
        columns={[
          {
            label: "File",
            cell: (file) => (
              <div className="flex items-center gap-3">
                {file.mimeType.startsWith("image/") ? (
                  <FileImage className="size-4 text-forest" />
                ) : (
                  <FileText className="size-4 text-forest" />
                )}
                <span className="font-medium">{file.filename}</span>
              </div>
            ),
          },
          { label: "Size", cell: (file) => bytesLabel(file.size) },
          {
            label: "Status",
            cell: (file) => <StatusBadge status={file.status} />,
          },
          { label: "Created", cell: (file) => dateLabel(file.createdAt) },
        ]}
        actions={(file) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={download.isPending || file.status !== "READY"}
              onClick={() =>
                download.mutate(file.id, {
                  onSuccess: (result) =>
                    setPreview({
                      filename: file.filename,
                      mimeType: file.mimeType,
                      url: result.url,
                    }),
                })
              }
            >
              <Download />
              Open
            </Button>
            {writable && (
              <ConfirmAction
                title={`Delete ${file.filename}?`}
                description="This permanently removes the saved artifact and its contents."
                action={() => remove.mutateAsync(file.id)}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${file.filename}`}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </ConfirmAction>
            )}
          </>
        )}
      />
      <DetailSheet
        title={preview?.filename ?? "Artifact"}
        description="Preview or download your saved file."
        open={!!preview}
        close={() => setPreview(null)}
      >
        {preview && (
          <>
            <Alert>
              <AlertDescription>
                This private download link is valid for five minutes.
              </AlertDescription>
            </Alert>
            {preview.mimeType.startsWith("image/") && (
              <img
                src={preview.url}
                alt={preview.filename}
                className="w-full border object-contain"
              />
            )}
            <Button asChild>
              <a href={preview.url} target="_blank" rel="noreferrer">
                <Download />
                Download file
              </a>
            </Button>
          </>
        )}
      </DetailSheet>
    </div>
  );
}
