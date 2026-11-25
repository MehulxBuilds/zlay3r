import { db } from "./db";
import { providerConfiguration, usageEvent } from "../schema/index";
import { and, eq } from "drizzle-orm";
export interface ModelUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usageKnown: boolean;
  estimatedCost?: number;
}
export async function priceModelUsage(
  organizationId: string,
  usage: ModelUsage,
) {
  const [configuration] = await db
    .select()
    .from(providerConfiguration)
    .where(
      and(
        eq(providerConfiguration.organizationId, organizationId),
        eq(providerConfiguration.provider, usage.provider),
      ),
    )
    .limit(1);
  const settings = configuration?.settings as
    | { inputPricePerMillion?: number; outputPricePerMillion?: number }
    | undefined;
  if (
    usage.usageKnown &&
    configuration?.model === usage.model &&
    settings?.inputPricePerMillion !== undefined &&
    settings.outputPricePerMillion !== undefined
  )
    return {
      ...usage,
      estimatedCost:
        (usage.inputTokens * settings.inputPricePerMillion +
          usage.outputTokens * settings.outputPricePerMillion) /
        1000000,
    };
  return usage;
}
export async function recordModelUsage(
  organizationId: string,
  runId: string,
  sequence: number,
  usage: ModelUsage,
) {
  if (!usage.usageKnown) return;
  const values = [
    {
      metric: "model_input_tokens",
      quantity: usage.inputTokens,
      unit: "tokens",
      key: "input",
    },
    {
      metric: "model_output_tokens",
      quantity: usage.outputTokens,
      unit: "tokens",
      key: "output",
    },
    ...(usage.estimatedCost !== undefined
      ? [
          {
            metric: "estimated_model_cost",
            quantity: usage.estimatedCost,
            unit: "USD",
            key: "cost",
          },
        ]
      : []),
  ];
  for (const value of values)
    await db
      .insert(usageEvent)
      .values({
        organizationId,
        metric: value.metric,
        quantity: String(value.quantity),
        unit: value.unit,
        idempotencyKey: `${runId}-response-${sequence}-${value.key}`,
        metadata: {
          provider: usage.provider,
          model: usage.model,
          runId,
          estimated: value.unit === "USD",
        },
      })
      .onConflictDoNothing();
}
