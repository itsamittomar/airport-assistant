import { RequestContext } from "@mastra/core/request-context";
import { getMastra } from "./mastra.js";
import { assertApiKey } from "./config.js";
import { endTrace, record, startTrace, type TraceEvent } from "./trace.js";

export interface RunResult {
  text: string;
  trace: TraceEvent[];
  /** Sub-agents the orchestrator delegated to, in order. */
  delegatedTo: string[];
  steps: number;
  durationMs: number;
  error?: string;
  /** Set when a guardrail intervened, e.g. "input:prompt-extraction" or "output:email". */
  guardrails?: string[];
}

/**
 * Mastra's `result.text` concatenates the text of *every* step, including the
 * model's "let me check that first..." narration before tool calls. Showing
 * that to a user produces self-contradicting answers (eval case
 * explicit-file-claim caught this). The user-facing answer is the text of the
 * final step only; earlier narration stays available in `steps` for debugging.
 */
function finalText(result: { text: string; steps?: Array<{ text?: string }> }): string {
  for (let i = (result.steps?.length ?? 0) - 1; i >= 0; i--) {
    const t = result.steps![i]?.text?.trim();
    if (t) return t;
  }
  return result.text;
}

/**
 * Single entry point used by the demo, the CLI and the evals.
 * Returns the answer *and* the execution trace so callers can reason about
 * behaviour, not just text. Never throws for model/tool failures — those are
 * reported in `error` so a batch eval run keeps going.
 */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface RunOptions {
  /**
   * Prior turns of the same conversation, oldest first. Lets the orchestrator
   * resolve follow-ups like "yes please" against what it just offered. Kept in
   * the caller (CLI) rather than a memory store so each run stays stateless
   * and the evals stay reproducible.
   */
  history?: Turn[];
}

export async function runConcierge(prompt: string, options: RunOptions = {}): Promise<RunResult> {
  assertApiKey();
  const mastra = await getMastra();
  const concierge = mastra.getAgent("concierge");
  const traceId = startTrace();
  const requestContext = new RequestContext<Record<string, unknown>>();
  requestContext.set("traceId", traceId);
  const started = Date.now();

  try {
    type Msg = { role: "user"; content: string } | { role: "assistant"; content: string };
    const messages: Msg[] = [
      ...(options.history ?? []).map<Msg>((t) => (t.role === "user" ? { role: "user", content: t.content } : { role: "assistant", content: t.content })),
      { role: "user", content: prompt },
    ];
    const result = await concierge.generate(messages, {
      requestContext,
      onStepFinish: (step) => {
        for (const call of step.toolCalls ?? []) {
          const name = (call as any).payload?.toolName ?? (call as any).toolName;
          if (typeof name === "string" && name.startsWith("agent-")) {
            const args = (call as any).payload?.args ?? (call as any).args ?? {};
            record(traceId, { kind: "delegation", from: "concierge", to: name.slice("agent-".length), prompt: String(args.prompt ?? ""), at: Date.now() });
          }
        }
      },
    });
    const trace = endTrace(traceId);
    const guardrails = [...((requestContext.get("guardrailViolations") as string[] | undefined) ?? [])];
    if (result.tripwire) {
      const rule = (result.tripwire.metadata as any)?.rule ?? result.tripwire.processorId ?? "tripwire";
      guardrails.unshift(`input:${rule}`);
    }
    return {
      text: result.tripwire ? result.tripwire.reason : finalText(result),
      guardrails: guardrails.length ? guardrails : undefined,
      trace,
      delegatedTo: trace.filter((e) => e.kind === "delegation").map((e) => (e as any).to),
      steps: result.steps?.length ?? 0,
      durationMs: Date.now() - started,
      error: result.error ? String(result.error.message ?? result.error) : undefined,
    };
  } catch (err) {
    const trace = endTrace(traceId);
    return {
      text: "",
      trace,
      delegatedTo: trace.filter((e) => e.kind === "delegation").map((e) => (e as any).to),
      steps: 0,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
