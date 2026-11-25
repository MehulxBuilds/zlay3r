import {
  trace,
  metrics,
  SpanStatusCode,
  type Attributes,
} from "@opentelemetry/api";
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
