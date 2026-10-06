import { createTool, type ToolExecutionContext } from "@mastra/core/tools";
import type { z } from "zod";
import { record, TRACE_KEY } from "../trace.js";
import { config } from "../config.js";

type AnyZod = z.ZodTypeAny;

/**
 * Wrap a tool implementation so that:
 *  1. every invocation is recorded in the trace (agent, tool, input, output);
 *  2. thrown errors become a structured `{ error }` result instead of crashing
 *     the agent loop — the model can then explain the failure to the user;
 *  3. a timeout bounds slow tools (important for MCP/network calls).
 *
 * `owner` is the agent the tool belongs to. Recording ownership at wrap time
 * is what lets evals assert "the lounge agent, not the flight agent, called
 * findLounges".
 */
export function tracedTool<In extends AnyZod, Out extends AnyZod>(opts: {
  id: string;
  owner: string;
  description: string;
  inputSchema: In;
  outputSchema?: Out;
  timeoutMs?: number;
  execute: (input: z.infer<In>, ctx: ToolExecutionContext) => Promise<z.infer<Out>>;
}) {
  const timeoutMs = opts.timeoutMs ?? config.toolTimeoutMs;
  return createTool({
    id: opts.id,
    description: opts.description,
    inputSchema: opts.inputSchema,
    // Output schema deliberately omitted from the model-facing tool so a
    // structured { error } result is always representable.
    execute: async (input, ctx) => {
      const traceId = ctx?.requestContext?.get(TRACE_KEY) as string | undefined;
      const started = Date.now();
      let output: unknown;
      let ok = true;
      try {
        output = await withTimeout(opts.execute(input as z.infer<In>, ctx as ToolExecutionContext), timeoutMs, opts.id);
      } catch (err) {
        ok = false;
        output = { error: true, message: err instanceof Error ? err.message : String(err) };
      }
      record(traceId, {
        kind: "tool",
        agent: opts.owner,
        tool: opts.id,
        input,
        output,
        ok,
        durationMs: Date.now() - started,
        at: started,
      });
      return output;
    },
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}
