"use client";
import { useState } from "react";
import { Button, Input, Badge } from "@repo/ui";
import { KeyRound, RotateCw, Trash2 } from "lucide-react";
import {
  useApiKeys,
  useCreateApiKey,
  useRotateApiKey,
  useRevokeApiKey,
  createKeySchema,
  scopes,
} from "@repo/web/hooks/api/keys";
import { ResourceTable } from "@repo/web/components/shared/resource-table";
import {
  ActionForm,
  CreateDialog,
  Field,
  CheckboxChoices,
  CredentialDialog,
} from "@repo/web/components/shared/forms";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
import { dateLabel } from "@repo/web/lib/format";
export function KeysView() {
  const query = useApiKeys();
  const create = useCreateApiKey();
  const rotate = useRotateApiKey();
  const revoke = useRevokeApiKey();
  const [token, setToken] = useState("");
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <CreateDialog
          title="Create API key"
          description="Select only the permissions your application needs."
        >
          {(close) => (
            <ActionForm
              schema={createKeySchema}
              pending={create.isPending}
              submit="Create key"
              onSubmit={async (input) => {
                const key = await create.mutateAsync(input);
                close();
                setToken(key.token);
              }}
            >
              <Field label="Name">
                <Input name="name" required placeholder="My application" />
              </Field>
              <Field
                label="Permissions"
                hint="Execution policies and organization permissions still apply."
              >
                <CheckboxChoices
                  name="scopes"
                  options={scopes.map((scope) => ({
                    value: scope,
                    label: scope.split(".").reverse().join(" "),
                  }))}
                  initial={["sandbox.read", "runs.read"]}
                />
              </Field>
            </ActionForm>
          )}
        </CreateDialog>
      </div>
      <ResourceTable
        rows={query.data?.pages.flatMap((page) => page.items) ?? []}
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
        more={query.hasNextPage}
        loadingMore={query.isFetchingNextPage}
        onMore={() => void query.fetchNextPage()}
        emptyTitle="Connect your first application"
        emptyDescription="Create a scoped API key to access your workspace from your code."
        columns={[
          {
            label: "Key",
            cell: (key) => (
              <div className="flex items-center gap-3">
                <KeyRound className="size-4 text-forest" />
                <div>
                  <p className="font-medium">{key.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {key.prefix}******
                  </p>
                </div>
              </div>
            ),
          },
          {
            label: "Permissions",
            cell: (key) => (
              <Badge variant="secondary">{key.scopes.length} selected</Badge>
            ),
          },
          {
            label: "Status",
            cell: (key) => (
              <Badge variant="outline">
                {key.revokedAt ? "Revoked" : "Active"}
              </Badge>
            ),
          },
          { label: "Created", cell: (key) => dateLabel(key.createdAt) },
        ]}
        actions={(key) =>
          !key.revokedAt && (
            <>
              <ConfirmAction
                destructive={false}
                title="Rotate this key?"
                description="A new token will be created and the current token revoked immediately. Update your application afterward."
                action={async () => {
                  const result = await rotate.mutateAsync(key.id);
                  setToken(result.token);
                }}
              >
                <Button variant="ghost" size="icon" aria-label="Rotate key">
                  <RotateCw className="size-4" />
                </Button>
              </ConfirmAction>
              <ConfirmAction
                title="Revoke this key?"
                description="Applications using this token will immediately lose access."
                action={() => revoke.mutateAsync(key.id)}
              >
                <Button variant="ghost" size="icon" aria-label="Revoke key">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </ConfirmAction>
            </>
          )
        }
      />
      <CredentialDialog
        value={token}
        title="Your API key"
        onClose={() => setToken("")}
      />
    </div>
  );
}
