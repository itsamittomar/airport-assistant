/** Mock airline operations data. Times are ISO 8601 with offsets. */
export type FlightStatus = "ON_TIME" | "DELAYED" | "CANCELLED" | "BOARDING" | "DEPARTED";

export interface Flight {
  flightNumber: string;
  airline: string;
  origin: string; // IATA
  destination: string; // IATA
  originCity: string;
  destinationCity: string;
  scheduledDeparture: string;
  estimatedDeparture: string | null;
  status: FlightStatus;
  delayMinutes: number;
  terminal: string;
  gate: string | null;
  reason?: string;
}

export const FLIGHTS: Record<string, Flight> = {
  BA117: {
    flightNumber: "BA117",
    airline: "British Airways",
    origin: "LHR",
    destination: "JFK",
    originCity: "London",
    destinationCity: "New York",
    scheduledDeparture: "2026-10-06T10:30:00+01:00",
    estimatedDeparture: "2026-10-06T13:45:00+01:00",
    status: "DELAYED",
    delayMinutes: 195,
    terminal: "5",
    gate: "B36",
    reason: "Late inbound aircraft",
  },
  EK5: {
    flightNumber: "EK5",
    airline: "Emirates",
    origin: "LHR",
    destination: "DXB",
    originCity: "London",
    destinationCity: "Dubai",
    scheduledDeparture: "2026-10-06T14:15:00+01:00",
    estimatedDeparture: "2026-10-06T14:15:00+01:00",
    status: "ON_TIME",
    delayMinutes: 0,
    terminal: "3",
    gate: "22",
  },
  VS3: {
    flightNumber: "VS3",
    airline: "Virgin Atlantic",
    origin: "LHR",
    destination: "JFK",
    originCity: "London",
    destinationCity: "New York",
    scheduledDeparture: "2026-10-06T11:00:00+01:00",
    estimatedDeparture: null,
    status: "CANCELLED",
    delayMinutes: 0,
    terminal: "3",
    gate: null,
    reason: "Crew availability",
  },
  SQ321: {
    flightNumber: "SQ321",
    airline: "Singapore Airlines",
    origin: "LHR",
    destination: "SIN",
    originCity: "London",
    destinationCity: "Singapore",
    scheduledDeparture: "2026-10-06T22:10:00+01:00",
    estimatedDeparture: "2026-10-06T22:40:00+01:00",
    status: "DELAYED",
    delayMinutes: 30,
    terminal: "2",
    gate: "A10",
    reason: "Air traffic control restrictions",
  },
};

/** Alternative flights on the same route, used for rebooking suggestions. */
export const ALTERNATIVES: Record<string, Array<{ flightNumber: string; airline: string; departs: string; seatsLeft: number; cabin: string }>> = {
  "LHR-JFK": [
    { flightNumber: "BA173", airline: "British Airways", departs: "2026-10-06T14:20:00+01:00", seatsLeft: 4, cabin: "Economy" },
    { flightNumber: "VS9", airline: "Virgin Atlantic", departs: "2026-10-06T16:05:00+01:00", seatsLeft: 11, cabin: "Economy" },
    { flightNumber: "AA101", airline: "American Airlines", departs: "2026-10-06T18:30:00+01:00", seatsLeft: 0, cabin: "Economy" },
  ],
  "LHR-DXB": [
    { flightNumber: "EK3", airline: "Emirates", departs: "2026-10-06T20:40:00+01:00", seatsLeft: 23, cabin: "Economy" },
  ],
};
