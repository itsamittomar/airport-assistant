export type Tier = "STANDARD" | "PLUS" | "PRESTIGE";
export const TIER_RANK: Record<Tier, number> = { STANDARD: 0, PLUS: 1, PRESTIGE: 2 };

export interface Member {
  memberId: string;
  name: string;
  tier: Tier;
  /** Lounge visits remaining this year (null = unlimited). */
  visitsRemaining: number | null;
  policyId: string | null;
}

export interface Policy {
  policyId: string;
  product: string;
  /** Delay (minutes) after which delay compensation is payable. */
  delayThresholdMinutes: number;
  /** Flat payout per qualifying delay, in GBP. */
  delayPayoutGbp: number;
  cancellationCoverGbp: number;
  active: boolean;
}

export const MEMBERS: Record<string, Member> = {
  "PP-1001": { memberId: "PP-1001", name: "Asha Patel", tier: "PRESTIGE", visitsRemaining: null, policyId: "TRV-889" },
  "PP-2002": { memberId: "PP-2002", name: "Tom Okafor", tier: "STANDARD", visitsRemaining: 2, policyId: "TRV-120" },
  "PP-3003": { memberId: "PP-3003", name: "Mei Lin", tier: "PLUS", visitsRemaining: 0, policyId: null },
};

export const POLICIES: Record<string, Policy> = {
  "TRV-889": { policyId: "TRV-889", product: "Travel Protect Premium", delayThresholdMinutes: 120, delayPayoutGbp: 150, cancellationCoverGbp: 2000, active: true },
  "TRV-120": { policyId: "TRV-120", product: "Travel Protect Basic", delayThresholdMinutes: 240, delayPayoutGbp: 75, cancellationCoverGbp: 500, active: true },
  "TRV-555": { policyId: "TRV-555", product: "Travel Protect Basic", delayThresholdMinutes: 240, delayPayoutGbp: 75, cancellationCoverGbp: 500, active: false },
};

/** In-memory claim store so repeated filings are detectable within a process. */
export const CLAIMS: Array<{ claimId: string; policyId: string; flightNumber: string; amountGbp: number; status: string; filedAt: string }> = [];
