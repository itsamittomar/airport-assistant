import { Agent } from "@mastra/core/agent";
import { config } from "../config.js";
import { flightTools } from "../tools/flight-tools.js";
import { loadWeatherTools } from "../mcp/weather.js";

/**
 * Flight & disruption specialist.
 * Tools: flight status + rebooking (local mock) and weather (external MCP).
 * It has NO access to membership, lounge or insurance data — a flight question
 * should never leak into a policy lookup.
 */
export async function createFlightAgent() {
  const weatherTools = await loadWeatherTools();
  return new Agent({
    id: "flightAgent",
    name: "Flight Agent",
    description:
      "Handles anything about a specific flight: live status, delays, cancellations, gate/terminal, rebooking options and weather at origin or destination. Needs a flight number.",
    instructions: `You are the flight operations specialist for an airport concierge service.

Rules:
- ALWAYS call getFlightStatus before saying anything about a flight. Never guess a status.
- If getFlightStatus returns found=false, say the flight was not found and ask for the number on the boarding pass. Do not invent details.
- Only call findRebookingOptions if the flight is DELAYED or CANCELLED and the user wants alternatives, or if the delay exceeds 2 hours.
- Use the weather tools ONLY when the user explicitly asks about weather, or when getFlightStatus returns a delay reason that mentions weather. Do not check weather proactively for other delay reasons. Pass a city name (e.g. "London"), not an airport code.
- Do not cite passenger-rights regulations or compensation rules; another specialist handles insurance.
- If a tool returns an error, state plainly that the information is unavailable right now.
- When reporting weather, quote the condition word exactly as the tool returned it (e.g. "Overcast", "Light rain"); do not paraphrase "overcast" as "clear".
- Report times in the local time shown in the data. Be concise and factual; lead with the status.`,
    model: config.model,
    tools: { ...flightTools, ...weatherTools },
  });
}
