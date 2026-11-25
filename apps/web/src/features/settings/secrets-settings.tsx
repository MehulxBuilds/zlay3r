"use client";
import { z } from "zod";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
} from "@repo/ui";
import { LockKeyhole, Trash2 } from "lucide-react";
import {
  useSecrets,
  useSaveSecret,
  useDeleteSecret,
  useSaveQuota,
} from "@repo/web/hooks/api/governance";
import {
  ActionForm,
  Field,
  ChoiceSelect,
} from "@repo/web/components/shared/forms";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
import { ErrorAlert } from "@repo/web/components/shared/feedback";
export function SecretsSettings() {
  const secrets = useSecrets();
  const save = useSaveSecret();
  const remove = useDeleteSecret();
  const quota = useSaveQuota();
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Encrypted secrets</CardTitle>
          <CardDescription>
            Values stay private. Reference a secret by its name when running
            commands or connecting tools.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ErrorAlert error={secrets.error} />
          {secrets.data?.map((secret) => (
            <div
              key={secret.id}
              className="flex items-center justify-between border-b pb-3"
            >
              <span className="flex items-center gap-2 text-sm">
                <LockKeyhole className="size-4 text-forest" />
                {secret.name}
              </span>
              <ConfirmAction
                title={`Delete ${secret.name}?`}
                description="Commands and tools referencing this secret will no longer receive it."
                action={() => remove.mutateAsync(secret.name)}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${secret.name}`}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </ConfirmAction>
            </div>
          ))}
          <ActionForm
            schema={z.object({
              name: z
                .string()
                .regex(
                  /^[A-Z][A-Z0-9_]{0,63}$/,
                  "Use uppercase letters, numbers and underscores",
                ),
              value: z.string().min(1),
            })}
            pending={save.isPending}
            submit="Save secret"
            onSubmit={async (input, form) => {
              await save.mutateAsync(input);
              form.reset();
            }}
          >
            <Field label="Name">
              <Input name="name" placeholder="SERVICE_TOKEN" required />
            </Field>
            <Field label="Value">
              <Input name="value" type="password" autoComplete="off" required />
            </Field>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Workspace quotas</CardTitle>
          <CardDescription>
            Monthly limits for runs, tokens and tool calls. Storage limits apply
            to total saved bytes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm
            schema={z.object({
              metric: z.enum([
                "tokens",
                "runs",
                "tool_calls",
                "artifact_bytes",
              ]),
              limit: z.coerce.number().nonnegative().max(1e12),
            })}
            pending={quota.isPending}
            submit="Update quota"
            onSubmit={async (input) => {
              await quota.mutateAsync(input);
            }}
          >
            <Field label="Resource">
              <ChoiceSelect
                name="metric"
                defaultValue="tokens"
                options={[
                  { value: "tokens", label: "Model tokens per month" },
                  { value: "runs", label: "Agent runs per month" },
                  { value: "tool_calls", label: "Tool calls per month" },
                  {
                    value: "artifact_bytes",
                    label: "Artifact storage (bytes)",
                  },
                ]}
              />
            </Field>
            <Field label="Limit">
              <Input
                name="limit"
                type="number"
                min={0}
                required
                placeholder="100000"
              />
            </Field>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
