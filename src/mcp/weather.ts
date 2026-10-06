import { MCPClient } from "@mastra/mcp";
import { z } from "zod";
import { config } from "../config.js";
import { tracedTool } from "../tools/traced.js";
import type { ToolsInput } from "@mastra/core/agent";

/**
 * External MCP integration: the open-meteo-mcp server (spawned over stdio via
 * npx). It gives the flight agent real weather at origin/destination, which is
 * the single most common cause of disruption and something our mock airline
 * data cannot provide.
 *
 * Design notes:
 *  - We expose only the two MCP tools the flight agent needs (weather + alerts)
 *    rather than all five; least-privilege applies to MCP tools too.
 *  - Each MCP tool is re-wrapped with tracedTool so it participates in tracing,
 *    timeouts and error normalisation exactly like our local tools.
 *  - If the server cannot start (no network, npx blocked, MCP_DISABLED=1) we
 *    fall back to stub tools that return a clear "unavailable" result. The
 *    agent still runs; it just tells the user weather could not be checked.
 */
const OWNER = "flightAgent";
const WANTED = ["weather_get_weather", "weather_get_weather_alerts"] as const;

let client: MCPClient | undefined;

export async function loadWeatherTools(): Promise<ToolsInput> {
  if (config.mcpDisabled) return unavailableTools("MCP disabled via MCP_DISABLED=1");
  try {
    client = new MCPClient({
      id: "weather-mcp",
      servers: { weather: { command: "npx", args: ["-y", "open-meteo-mcp"] } },
      timeout: config.toolTimeoutMs,
    });
    const all = await client.listTools();
    const out: ToolsInput = {};
    for (const name of WANTED) {
      const mcpTool = all[name];
      if (!mcpTool) throw new Error(`MCP server did not expose ${name}`);
      out[name] = tracedTool({
        id: name,
        owner: OWNER,
        description: `${mcpTool.description ?? name} (live data via open-meteo MCP server). ONLY use when the traveller explicitly asks about weather or the flight's delay reason mentions weather — never proactively. Pass a city name such as "London" or "New York".`,
        inputSchema: z.object({ location: z.string().min(1).describe("City name, e.g. London") }),
        execute: async (input, ctx) => {
          const res = await mcpTool.execute!(input as any, ctx as any);
          return res as unknown;
        },
      });
    }
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mcp] weather server unavailable: ${message}`);
    await closeWeatherMcp();
    return unavailableTools(message);
  }
}

function unavailableTools(reason: string) {
  const out: ToolsInput = {};
  for (const name of WANTED) {
    out[name] = tracedTool({
      id: name,
      owner: OWNER,
      description: `${name} — currently unavailable. Calling it returns an error explaining why.`,
      inputSchema: z.object({ location: z.string().min(1) }),
      execute: async () => ({ error: true, message: `Weather service unavailable: ${reason}` }),
    });
  }
  return out;
}

export async function closeWeatherMcp(): Promise<void> {
  try {
    await client?.disconnect();
  } catch {
    /* already closed */
  } finally {
    client = undefined;
  }
}
