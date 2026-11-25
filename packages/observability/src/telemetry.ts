import {
  context,
  propagation,
  trace,
  SpanStatusCode,
  metrics,
  type Attributes,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { server_env as env } from "@repo/env";

let sdk: NodeSDK | undefined;
export interface RequestTrace {
  run<T>(work: () => T): T;
  end(status: number): void;
}
export function requestTrace(
  carrier: Record<string, string>,
  attributes: Attributes,
): RequestTrace {
  const parent = propagation.extract(context.active(), carrier);
  const current = trace
    .getTracer("zlayer")
    .startSpan("api.request", { attributes }, parent);
  const scope = trace.setSpan(parent, current);
  let ended = false;
  return {
    run: (work) => context.with(scope, work),
    end(status) {
      if (ended) return;
      ended = true;
      current.setAttribute("http.response.status_code", status);
      if (status >= 500) current.setStatus({ code: SpanStatusCode.ERROR });
      current.end();
    },
  };
}
export function startTelemetry(serviceName: string) {
  if (sdk || !env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "");
  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        exportIntervalMillis: 30000,
      }),
    ],
  });
  sdk.start();
}
export async function stopTelemetry() {
  await sdk?.shutdown();
}
export function recordQueueWait(createdAt: Date, runId: string) {
  const current = trace
    .getTracer("zlayer")
    .startSpan("queue.wait", {
      startTime: createdAt,
      attributes: { "run.id": runId },
    });
  current.end(new Date());
}
export function traceCarrier() {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}
export function withCarrier<T>(
  carrier: Record<string, string>,
  work: () => T,
): T {
  return context.with(propagation.extract(context.active(), carrier), work);
}
export async function span<T>(
  name: string,
  attributes: Attributes,
  work: () => Promise<T>,
): Promise<T> {
  return trace
    .getTracer("zlayer")
    .startActiveSpan(name, { attributes }, async (current) => {
      const started = Date.now();
      try {
        return await work();
      } catch (error) {
        current.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.name : "ERROR",
        });
        current.recordException({
          name: error instanceof Error ? error.name : "ERROR",
          message: "Operation failed; consult authorized execution records",
        });
        throw error;
      } finally {
        metrics
          .getMeter("zlayer")
          .createHistogram("operation.duration", { unit: "ms" })
          .record(Date.now() - started, { operation: name });
        current.end();
      }
    });
}
