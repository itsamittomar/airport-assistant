import { z } from "zod";
import { tracedTool } from "./traced.js";
import { ALTERNATIVES, FLIGHTS } from "../data/flights.js";

const OWNER = "flightAgent";

/** Airline flight numbers: 2-3 char IATA/ICAO carrier code + 1-4 digits. */
export const flightNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,3}\d{1,4}$/, "Flight number must look like BA117 or EK5");

export const getFlightStatus = tracedTool({
  id: "getFlightStatus",
  owner: OWNER,
  description:
    "Look up the live status of a flight by flight number (e.g. BA117): scheduled vs estimated departure, delay in minutes, terminal, gate and reason. Returns found=false if the flight is unknown.",
  inputSchema: z.object({ flightNumber: flightNumberSchema }),
  execute: async ({ flightNumber }) => {
    const f = FLIGHTS[flightNumber];
    if (!f) {
      return {
        found: false as const,
        flightNumber,
        message: `No flight ${flightNumber} is operating today. Ask the traveller to check the number on their boarding pass.`,
      };
    }
    return { found: true as const, ...f };
  },
});

export const findRebookingOptions = tracedTool({
  id: "findRebookingOptions",
  owner: OWNER,
  description:
    "Find alternative flights on the same route as a disrupted flight, with departure times and seats left. Use after confirming a flight is DELAYED or CANCELLED.",
  inputSchema: z.object({ flightNumber: flightNumberSchema }),
  execute: async ({ flightNumber }) => {
    const f = FLIGHTS[flightNumber];
    if (!f) return { found: false as const, flightNumber, options: [], message: `Unknown flight ${flightNumber}` };
    const options = (ALTERNATIVES[`${f.origin}-${f.destination}`] ?? [])
      .filter((o) => o.flightNumber !== flightNumber)
      .map((o) => ({ ...o, bookable: o.seatsLeft > 0 }));
    return { found: true as const, route: `${f.origin}-${f.destination}`, options };
  },
});

export const flightTools = { getFlightStatus, findRebookingOptions };
