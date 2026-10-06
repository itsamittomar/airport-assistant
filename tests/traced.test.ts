import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RequestContext } from "@mastra/core/request-context";
import { tracedTool, withTimeout } from "../src/tools/traced.js";
import { endTrace, startTrace, toolCalls } from "../src/trace.js";

function ctx() {
  const traceId = startTrace();
  const requestContext = new RequestContext<Record<string, unknown>>();
  requestContext.set("traceId", traceId);
  return { traceId, requestContext };
}

describe("tracedTool failure handling", () => {
  it("converts a thrown error into a structured result and records ok=false", async () => {
    const boom = tracedTool({
      id: "boom",
      owner: "testAgent",
      description: "always fails",
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error("upstream exploded");
      },
    });
    const { traceId, requestContext } = ctx();
    const out: any = await boom.execute!({}, { requestContext } as any);
    expect(out).toEqual({ error: true, message: "upstream exploded" });
    const [call] = toolCalls(endTrace(traceId));
    expect(call.ok).toBe(false);
    expect(call.agent).toBe("testAgent");
  });

  it("times out slow tools instead of hanging the agent loop", async () => {
    const slow = tracedTool({
      id: "slow",
      owner: "testAgent",
      description: "never resolves in time",
      inputSchema: z.object({}),
      timeoutMs: 20,
      execute: () => new Promise((r) => setTimeout(() => r({ late: true }), 500)),
    });
    const { requestContext } = ctx();
    const out: any = await slow.execute!({}, { requestContext } as any);
    expect(out.error).toBe(true);
    expect(out.message).toMatch(/timed out after 20ms/);
  });

  it("does not record when no trace id is present", async () => {
    const t = tracedTool({ id: "t", owner: "x", description: "d", inputSchema: z.object({}), execute: async () => ({ ok: 1 }) });
    const out = await t.execute!({}, {} as any);
    expect(out).toEqual({ ok: 1 });
  });

  it("withTimeout resolves normally when fast enough", async () => {
    await expect(withTimeout(Promise.resolve(42), 100, "fast")).resolves.toBe(42);
  });
});
