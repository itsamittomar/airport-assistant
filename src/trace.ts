/**
 * Lightweight execution trace.
 *
 * Why this exists: the brief asks us to evaluate *delegation and tool use*, not
 * just the final text. Mastra surfaces the orchestrator's own tool calls (which
 * include the `agent-<name>` delegation calls), but a sub-agent's tool calls are
 * internal to that sub-agent's run. Rather than depend on framework internals,
 * every tool we author is wrapped (see tools/traced.ts) and reports here.
 *
 * Correlation: a `traceId` is placed in the Mastra RequestContext at the start
 * of a run. Mastra forwards the parent's request context to sub-agents, so
 * tools at any depth can find it.
 */
export type TraceEvent =
  | {
      kind: "tool";
      agent: string;
      tool: string;
      input: unknown;
      output: unknown;
      ok: boolean;
      durationMs: number;
      at: number;
    }
  | { kind: "delegation"; from: string; to: string; prompt: string; at: number };

const traces = new Map<string, TraceEvent[]>();

export const TRACE_KEY = "traceId";

export function startTrace(): string {
  const id = globalThis.crypto.randomUUID();
  traces.set(id, []);
  return id;
}

export function record(traceId: string | undefined, event: TraceEvent): void {
  if (!traceId) return;
  const events = traces.get(traceId);
  if (events) events.push(event);
}

export function getTrace(traceId: string): TraceEvent[] {
  return traces.get(traceId) ?? [];
}

export function endTrace(traceId: string): TraceEvent[] {
  const events = traces.get(traceId) ?? [];
  traces.delete(traceId);
  return events;
}

/** Convenience views used by evals and the demo printer. */
export function toolCalls(events: TraceEvent[]) {
  return events.filter((e): e is Extract<TraceEvent, { kind: "tool" }> => e.kind === "tool");
}
export function delegations(events: TraceEvent[]) {
  return events.filter((e): e is Extract<TraceEvent, { kind: "delegation" }> => e.kind === "delegation");
}
