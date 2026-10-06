import { describe, expect, it, beforeAll } from "vitest";

/**
 * Tool-scoping contract tests. These run without any LLM call: they construct
 * the agents and assert on which tools each one exposes. If someone later
 * hands the lounge agent a claims tool, this fails in CI.
 */
process.env.MCP_DISABLED = "1"; // don't spawn the MCP server in unit tests
process.env.OPEN_ROUTER_KEY ??= "test-key-not-used";

let concierge: any, flightAgent: any, loungeAgent: any, claimsAgent: any;

beforeAll(async () => {
  const c = await import("../src/agents/concierge.js");
  concierge = await c.createConcierge();
  ({ loungeAgent } = await import("../src/agents/lounge-agent.js"));
  ({ claimsAgent } = await import("../src/agents/claims-agent.js"));
  const f = await import("../src/agents/flight-agent.js");
  flightAgent = await f.createFlightAgent();
});

async function toolIds(agent: any): Promise<string[]> {
  const tools = await agent.listTools();
  return Object.keys(tools).sort();
}

describe("agent tool scoping", () => {
  it("concierge owns no domain tools, only sub-agents", async () => {
    expect(await toolIds(concierge)).toEqual([]);
    const agents = await concierge.listAgents();
    expect(Object.keys(agents).sort()).toEqual(["claimsAgent", "flightAgent", "loungeAgent"]);
  });

  it("flight agent has flight + weather(MCP) tools only", async () => {
    expect(await toolIds(flightAgent)).toEqual(["findRebookingOptions", "getFlightStatus", "weather_get_weather", "weather_get_weather_alerts"]);
  });

  it("lounge agent has lounge tools only", async () => {
    expect(await toolIds(loungeAgent)).toEqual(["checkLoungeAccess", "findLounges"]);
  });

  it("claims agent has claims tools only", async () => {
    expect(await toolIds(claimsAgent)).toEqual(["checkPolicyCoverage", "fileDelayClaim"]);
  });

  it("weather tools degrade gracefully when MCP is disabled", async () => {
    const tools = await flightAgent.listTools();
    const out: any = await tools.weather_get_weather.execute({ location: "London" }, {});
    expect(out.error).toBe(true);
    expect(out.message).toMatch(/unavailable/i);
  });
});
