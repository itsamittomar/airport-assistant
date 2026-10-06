import { z } from "zod";
import { tracedTool } from "./traced.js";
import { LOUNGES } from "../data/lounges.js";
import { MEMBERS, TIER_RANK } from "../data/members.js";

const OWNER = "loungeAgent";

const iata = z.string().trim().toUpperCase().length(3, "Airport code must be a 3-letter IATA code");
export const memberIdSchema = z.string().trim().toUpperCase().regex(/^PP-\d{4}$/, "Member IDs look like PP-1001");

export const findLounges = tracedTool({
  id: "findLounges",
  owner: OWNER,
  description:
    "List lounges at an airport, optionally filtered by terminal. Returns lounge ids (use these exact ids with checkLoungeAccess), location, opening hours, amenities, occupancy and the minimum membership tier. Lounges at >=95% occupancy are flagged as full.",
  inputSchema: z.object({ airport: iata, terminal: z.string().trim().optional() }),
  execute: async ({ airport, terminal }) => {
    const lounges = LOUNGES.filter((l) => l.airport === airport && (!terminal || l.terminal === terminal)).map((l) => ({
      ...l,
      isFull: l.occupancyPct >= 95,
    }));
    if (lounges.length === 0) {
      return { airport, terminal: terminal ?? null, lounges: [], message: `No partner lounges at ${airport}${terminal ? ` terminal ${terminal}` : ""}.` };
    }
    return { airport, terminal: terminal ?? null, lounges };
  },
});

export const checkLoungeAccess = tracedTool({
  id: "checkLoungeAccess",
  owner: OWNER,
  description:
    "Check whether a member can enter a specific lounge right now: validates membership, tier, remaining visits and lounge capacity. Returns the reason if entry is not possible and any guest fee.",
  inputSchema: z.object({ memberId: memberIdSchema, loungeId: z.string().trim(), guests: z.number().int().min(0).max(5).default(0) }),
  execute: async ({ memberId, loungeId, guests }) => {
    const member = MEMBERS[memberId];
    if (!member) return { allowed: false as const, reason: "MEMBER_NOT_FOUND", message: `No membership found for ${memberId}.` };
    const lounge = LOUNGES.find((l) => l.id === loungeId);
    if (!lounge) return { allowed: false as const, reason: "LOUNGE_NOT_FOUND", message: `Unknown lounge id ${loungeId}. Use findLounges to get valid ids.` };
    if (TIER_RANK[member.tier] < TIER_RANK[lounge.minTier]) {
      return { allowed: false as const, reason: "TIER_TOO_LOW", message: `${lounge.name} requires ${lounge.minTier} tier; member is ${member.tier}.`, lounge: lounge.name };
    }
    if (member.visitsRemaining !== null && member.visitsRemaining <= 0) {
      return { allowed: false as const, reason: "NO_VISITS_REMAINING", message: "Member has used all included lounge visits this year. Paid entry may be available at the door.", lounge: lounge.name };
    }
    if (lounge.occupancyPct >= 95) {
      return { allowed: false as const, reason: "LOUNGE_FULL", message: `${lounge.name} is at capacity (${lounge.occupancyPct}%). Suggest an alternative lounge.`, lounge: lounge.name };
    }
    return {
      allowed: true as const,
      lounge: lounge.name,
      memberName: member.name,
      tier: member.tier,
      guestsRequested: guests,
      guestFeePerGuestGbp: lounge.guestFeeGbp,
      totalGuestFeeGbp: guests * lounge.guestFeeGbp,
      maxStayHours: lounge.maxStayHours,
      visitsRemainingAfter: member.visitsRemaining === null ? null : member.visitsRemaining - 1,
    };
  },
});

export const loungeTools = { findLounges, checkLoungeAccess };
