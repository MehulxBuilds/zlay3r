"use client";
import { z } from "zod";
import {
  Alert,
  AlertDescription,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Input,
} from "@repo/ui";
import {
  usePolicy,
  useTools,
  useSavePolicy,
} from "@repo/web/hooks/api/governance";
import {
  ActionForm,
  Field,
  CheckboxChoices,
  TagInput,
} from "@repo/web/components/shared/forms";
import { ErrorAlert, LoadingCards } from "@repo/web/components/shared/feedback";
const formSchema = z.object({
  allowedTools: z.array(z.string()).default([]),
  requireApproval: z.array(z.string()).default([]),
  approvedHosts: z.array(z.string()).default([]),
  allowedCommands: z.array(z.string()).default([]),
  maxTokens: z.coerce.number().int().min(1).max(1000000),
  maxToolCalls: z.coerce.number().int().min(1).max(128),
  deadlineMs: z.coerce.number().int().min(1000).max(900000),
});
export function PolicySettings() {
  const query = usePolicy();
  const tools = useTools();
  const save = useSavePolicy();
  if (query.isPending || tools.isPending) return <LoadingCards />;
  if (!query.data || !tools.data)
    return (
      <ErrorAlert
        error={query.error ?? tools.error}
        retry={() => {
          void query.refetch();
          void tools.refetch();
        }}
      />
    );
  const options = [
    ...new Set(
      [...tools.data.builtins, ...tools.data.registered].map(
        (tool) => tool.name,
      ),
    ),
  ].map((name) => ({ value: name, label: name.replaceAll("_", " ") }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution policy</CardTitle>
        <CardDescription>
          Decide what agents can do and where they can go.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm
          key={JSON.stringify(query.data)}
          schema={formSchema}
          pending={save.isPending}
          submit="Save execution policy"
          onSubmit={async (input) => {
            await save.mutateAsync(input);
          }}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <Field label="Allowed tools">
              <CheckboxChoices
                name="allowedTools"
                initial={query.data.allowedTools}
                options={options}
              />
            </Field>
            <Field label="Tools requiring approval">
              <CheckboxChoices
                name="requireApproval"
                initial={query.data.requireApproval}
                options={options}
              />
            </Field>
            <Field
              label="Allowed public hosts"
              hint="Add hosts individually. New host rules apply to new sandboxes."
            >
              <TagInput
                name="approvedHosts"
                initial={query.data.approvedHosts}
                placeholder="api.example.com"
                validate={z
                  .string()
                  .trim()
                  .toLowerCase()
                  .regex(
                    /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i,
                    "Enter a public hostname, without https:// or a path",
                  )}
              />
            </Field>
            <Field
              label="Allowed exact commands"
              hint="Optional. An empty list permits any command allowed by the tool policy."
            >
              <TagInput
                name="allowedCommands"
                initial={query.data.allowedCommands}
                placeholder="ls -la"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Token budget">
              <Input
                name="maxTokens"
                type="number"
                defaultValue={query.data.maxTokens}
                min={1}
                required
              />
            </Field>
            <Field label="Tool-call limit">
              <Input
                name="maxToolCalls"
                type="number"
                defaultValue={query.data.maxToolCalls}
                min={1}
                max={128}
                required
              />
            </Field>
            <Field label="Deadline (milliseconds)">
              <Input
                name="deadlineMs"
                type="number"
                defaultValue={query.data.deadlineMs}
                min={1000}
                required
              />
            </Field>
          </div>
          <Alert>
            <AlertDescription>
              Changing allowed hosts stops active sandboxes. Create new
              sandboxes to use the updated network policy.
            </AlertDescription>
          </Alert>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
