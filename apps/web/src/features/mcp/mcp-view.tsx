"use client";
import { useState } from "react";
import { Button, Input } from "@repo/ui";
import { Plug, Search, Trash2 } from "lucide-react";
import {
  useMcpServers,
  useCreateMcp,
  useDiscoverMcp,
  useDeleteMcp,
  mcpFormSchema,
} from "@repo/web/hooks/api/mcp";
import { useSecrets } from "@repo/web/hooks/api/governance";
import {
  ActionForm,
  CreateDialog,
  Field,
  ChoiceSelect,
} from "@repo/web/components/shared/forms";
import { ResourceTable } from "@repo/web/components/shared/resource-table";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
import { DetailSheet } from "@repo/web/components/shared/detail-sheet";
export function McpView() {
  const query = useMcpServers();
  const create = useCreateMcp();
  const discover = useDiscoverMcp();
  const remove = useDeleteMcp();
  const secrets = useSecrets();
  const [inspecting, setInspecting] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <CreateDialog
          title="Connect an MCP server"
          description="Add an HTTPS tool server. Allow its hostname in your execution policy first."
          label="Add connection"
        >
          {(close) => (
            <ActionForm
              schema={mcpFormSchema}
              pending={create.isPending}
              submit="Add connection"
              onSubmit={async (input) => {
                await create.mutateAsync(input);
                close();
              }}
            >
              <Field label="Connection name">
                <Input name="name" required placeholder="My tools" />
              </Field>
              <Field label="Server URL">
                <Input
                  name="url"
                  type="url"
                  required
                  placeholder="https://tools.example.com/mcp"
                />
              </Field>
              <Field
                label="Authorization secret"
                hint="Optional. Select an existing secret containing the authorization header value."
              >
                <ChoiceSelect
                  name="authorizationSecret"
                  placeholder="No authorization header"
                  options={
                    secrets.data?.map((secret) => ({
                      value: secret.name,
                      label: secret.name,
                    })) ?? []
                  }
                />
              </Field>
            </ActionForm>
          )}
        </CreateDialog>
      </div>
      <ResourceTable
        rows={query.data ?? []}
        loading={query.isPending}
        error={query.error}
        retry={() => void query.refetch()}
        emptyTitle="More tools. More possibilities."
        emptyDescription="Connect an MCP server to expand what your agents can do."
        columns={[
          {
            label: "Connection",
            cell: (server) => (
              <div className="flex gap-3 font-medium">
                <Plug className="size-4 text-forest" />
                {server.name}
              </div>
            ),
          },
          {
            label: "Transport",
            cell: (server) => server.transport.toUpperCase(),
          },
        ]}
        actions={(server) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={discover.isPending}
              onClick={() =>
                discover.mutate(server.id, {
                  onSuccess: () => setInspecting(true),
                })
              }
            >
              <Search />
              Discover tools
            </Button>
            <ConfirmAction
              title="Remove MCP connection?"
              description="Agents won't discover tools from this server in future runs."
              action={() => remove.mutateAsync(server.id)}
            >
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${server.name}`}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </ConfirmAction>
          </>
        )}
      />
      <DetailSheet
        title="Discovered tools"
        description="Use the platform tool names in your execution policy."
        open={inspecting}
        close={() => setInspecting(false)}
      >
        {discover.data?.map((tool) => (
          <div key={tool.platformName} className="border-b pb-4">
            <h3 className="font-semibold">{tool.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {tool.description}
            </p>
            <p className="mt-3 text-xs text-forest">
              Policy name: {tool.platformName}
            </p>
          </div>
        ))}
      </DetailSheet>
    </div>
  );
}
