export interface Lounge {
  id: string;
  name: string;
  airport: string; // IATA
  terminal: string;
  location: string;
  openingHours: string; // local time
  amenities: string[];
  /** Current occupancy as a percentage; >= 95 means walk-ins are being turned away. */
  occupancyPct: number;
  /** Minimum membership tier for free entry. */
  minTier: "STANDARD" | "PLUS" | "PRESTIGE";
  guestFeeGbp: number;
  maxStayHours: number;
}

export const LOUNGES: Lounge[] = [
  {
    id: "LHR-T5-ASPIRE",
    name: "Aspire Lounge",
    airport: "LHR",
    terminal: "5",
    location: "Airside, after security, Level 3 near Gate A18",
    openingHours: "05:00-22:00",
    amenities: ["Hot food", "Showers", "Wi-Fi", "Bar", "Quiet zone"],
    occupancyPct: 62,
    minTier: "STANDARD",
    guestFeeGbp: 35,
    maxStayHours: 3,
  },
  {
    id: "LHR-T5-PLAZA",
    name: "Plaza Premium Lounge",
    airport: "LHR",
    terminal: "5",
    location: "Airside, Level 2 opposite Gate B40",
    openingHours: "05:30-21:30",
    amenities: ["Hot food", "Showers", "Wi-Fi", "Nap rooms"],
    occupancyPct: 97,
    minTier: "PLUS",
    guestFeeGbp: 40,
    maxStayHours: 3,
  },
  {
    id: "LHR-T3-CLUB",
    name: "Club Aspire",
    airport: "LHR",
    terminal: "3",
    location: "Airside, Level 1 near Gate 10",
    openingHours: "05:00-22:30",
    amenities: ["Snacks", "Wi-Fi", "Showers"],
    occupancyPct: 48,
    minTier: "STANDARD",
    guestFeeGbp: 32,
    maxStayHours: 3,
  },
  {
    id: "LHR-T2-PLAZA",
    name: "Plaza Premium Lounge",
    airport: "LHR",
    terminal: "2",
    location: "Airside, Level 5 above Gate A",
    openingHours: "05:00-22:00",
    amenities: ["Hot food", "Wi-Fi", "Showers", "Bar"],
    occupancyPct: 70,
    minTier: "STANDARD",
    guestFeeGbp: 40,
    maxStayHours: 3,
  },
  {
    id: "JFK-T7-ALASKA",
    name: "Alaska Lounge",
    airport: "JFK",
    terminal: "7",
    location: "Airside, past security on the left",
    openingHours: "06:00-21:00",
    amenities: ["Snacks", "Wi-Fi", "Barista coffee"],
    occupancyPct: 40,
    minTier: "STANDARD",
    guestFeeGbp: 30,
    maxStayHours: 2,
  },
  {
    id: "DXB-T3-MARHABA",
    name: "Marhaba Lounge",
    airport: "DXB",
    terminal: "3",
    location: "Concourse B, Level 2",
    openingHours: "24 hours",
    amenities: ["Hot food", "Showers", "Wi-Fi", "Prayer room"],
    occupancyPct: 55,
    minTier: "STANDARD",
    guestFeeGbp: 38,
    maxStayHours: 4,
  },
];
