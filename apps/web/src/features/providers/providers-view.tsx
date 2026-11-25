"use client";
import { useState } from "react";
import {
  Button,
  Input,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@repo/ui";
import { Braces, Trash2 } from "lucide-react";
import {
  useProviders,
  useConfigureProvider,
  useDeleteProvider,
  providerFormSchema,
} from "@repo/web/hooks/api/providers";
import {
  ActionForm,
  CreateDialog,
  Field,
  CheckboxChoices,
  TagInput,
  ChoiceSelect,
} from "@repo/web/components/shared/forms";
import { ConfirmAction } from "@repo/web/components/shared/confirm-action";
import {
  EmptyState,
  ErrorAlert,
  LoadingCards,
} from "@repo/web/components/shared/feedback";
const options = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "openrouter", label: "OpenRouter" },
];
export function ProvidersView({ admin }: { admin: boolean }) {
  const [primaryProvider, setPrimaryProvider] = useState("openai");
  const query = useProviders();
  const configure = useConfigureProvider();
  const remove = useDeleteProvider();
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        {admin && (
          <CreateDialog
            title="Configure a model provider"
            description="Credentials are encrypted and never returned by the API."
            label="Add provider"
          >
            {(close) => (
              <ActionForm
                schema={providerFormSchema}
                pending={configure.isPending}
                submit="Save provider"
                onSubmit={async (input) => {
                  await configure.mutateAsync(input);
                  close();
                }}
              >
                <Field label="Provider">
                  <ChoiceSelect
                    onValueChange={setPrimaryProvider}
                    name="provider"
                    defaultValue="openai"
                    options={options}
                  />
                </Field>
                <Field label="Default model">
                  <Input name="model" required placeholder="Model identifier" />
                </Field>
                <Field label="API key">
                  <Input
                    name="apiKey"
                    type="password"
                    autoComplete="off"
                    required
                  />
                </Field>
                <Field
                  label="Fallback providers"
                  hint="Selected providers are tried in the order shown below."
                >
                  <CheckboxChoices
                    key={primaryProvider}
                    name="fallbacks"
                    options={options.filter(
                      (option) => option.value !== primaryProvider,
                    )}
                  />
                </Field>
                <Field
                  label="Model aliases"
                  hint="Add an alias and its model, for example fast=gpt-model."
                >
                  <TagInput name="aliases" placeholder="alias=model" />
                </Field>
                <Field
                  label="OpenRouter routing order"
                  hint="Optional provider names, added in priority order."
                >
                  <TagInput name="routingOrder" placeholder="Provider name" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="Input price / 1M tokens"
                    hint="Optional USD estimate."
                  >
                    <Input name="inputPrice" type="number" min={0} step="any" />
                  </Field>
                  <Field
                    label="Output price / 1M tokens"
                    hint="Optional USD estimate."
                  >
                    <Input
                      name="outputPrice"
                      type="number"
                      min={0}
                      step="any"
                    />
                  </Field>
                </div>
              </ActionForm>
            )}
          </CreateDialog>
        )}
      </div>
      <ErrorAlert error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <LoadingCards />
      ) : !query.data?.length ? (
        <Card>
          <EmptyState
            title="Find your agent's thinking partner"
            description="Connect OpenAI, Anthropic, DeepSeek, or OpenRouter to start running agents."
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {query.data.map((provider) => (
            <Card key={provider.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center bg-primary/20">
                    <Braces className="size-5 text-forest" />
                  </span>
                  <Badge className="bg-primary/20 text-forest">Connected</Badge>
                </div>
                <CardTitle className="pt-4 text-xl">
                  {
                    options.find((option) => option.value === provider.provider)
                      ?.label
                  }
                </CardTitle>
                <CardDescription>{provider.model}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {provider.settings.fallbacks?.map((fallback) => (
                    <Badge key={fallback} variant="outline">
                      Fallback: {fallback}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Configure this provider again to change its model, credentials
                  or routing.
                </p>
                {admin && (
                  <ConfirmAction
                    title="Remove model provider?"
                    description="Agents won't be able to use these credentials for new requests."
                    action={() => remove.mutateAsync(provider.provider)}
                  >
                    <Button variant="ghost" className="px-0 text-destructive">
                      <Trash2 />
                      Remove provider
                    </Button>
                  </ConfirmAction>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
