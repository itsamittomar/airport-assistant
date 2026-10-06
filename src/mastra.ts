import { Mastra } from "@mastra/core";
import { createConcierge } from "./agents/concierge.js";
import { closeWeatherMcp } from "./mcp/weather.js";

/**
 * Builds the Mastra instance once per process. Async because the flight agent
 * must discover MCP tools before it can be constructed.
 */
let instance: Promise<Mastra> | undefined;

export function getMastra(): Promise<Mastra> {
  instance ??= (async () => {
    const concierge = await createConcierge();
    return new Mastra({ agents: { concierge }, logger: false });
  })();
  return instance;
}

export async function shutdown(): Promise<void> {
  await closeWeatherMcp();
}
