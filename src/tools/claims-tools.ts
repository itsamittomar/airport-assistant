import { z } from "zod";
import { tracedTool } from "./traced.js";
import { CLAIMS, MEMBERS, POLICIES } from "../data/members.js";
import { FLIGHTS } from "../data/flights.js";
import { flightNumberSchema } from "./flight-tools.js";
import { memberIdSchema } from "./lounge-tools.js";
import { getTrace, TRACE_KEY, toolCalls } from "../trace.js";

const OWNER = "claimsAgent";

export const checkPolicyCoverage = tracedTool({
  id: "checkPolicyCoverage",
  owner: OWNER,
  description:
    "Look up a member's travel insurance policy and determine whether a given flight's delay or cancellation qualifies for compensation, and for how much. Always call this before filing a claim.",
  inputSchema: z.object({ memberId: memberIdSchema, flightNumber: flightNumberSchema }),
  execute: async ({ memberId, flightNumber }) => {
    const member = MEMBERS[memberId];
    if (!member) return { eligible: false as const, reason: "MEMBER_NOT_FOUND", message: `No membership found for ${memberId}.` };
    if (!member.policyId) return { eligible: false as const, reason: "NO_POLICY", message: `${member.name} has no travel insurance policy attached to their membership.` };
    const policy = POLICIES[member.policyId];
    if (!policy || !policy.active) return { eligible: false as const, reason: "POLICY_INACTIVE", message: `Policy ${member.policyId} is not active.` };
    const flight = FLIGHTS[flightNumber];
    if (!flight) return { eligible: false as const, reason: "FLIGHT_NOT_FOUND", message: `Flight ${flightNumber} not found; cannot assess disruption.` };

    if (flight.status === "CANCELLED") {
      return { eligible: true as const, claimType: "CANCELLATION" as const, policyId: policy.policyId, product: policy.product, maxPayoutGbp: policy.cancellationCoverGbp, flightNumber };
    }
    if (flight.status === "DELAYED" && flight.delayMinutes >= policy.delayThresholdMinutes) {
      return { eligible: true as const, claimType: "DELAY" as const, policyId: policy.policyId, product: policy.product, payoutGbp: policy.delayPayoutGbp, delayMinutes: flight.delayMinutes, thresholdMinutes: policy.delayThresholdMinutes, flightNumber };
    }
    return {
      eligible: false as const,
      reason: "BELOW_THRESHOLD",
      policyId: policy.policyId,
      product: policy.product,
      delayMinutes: flight.delayMinutes,
      thresholdMinutes: policy.delayThresholdMinutes,
      message: `Delay of ${flight.delayMinutes} min is below the ${policy.delayThresholdMinutes} min threshold on ${policy.product}.`,
    };
  },
});

export const fileDelayClaim = tracedTool({
  id: "fileDelayClaim",
  owner: OWNER,
  description:
    "File a compensation claim for a disrupted flight on the member's policy. Only call after checkPolicyCoverage reported eligible=true. Rejects duplicate claims for the same flight.",
  inputSchema: z.object({ memberId: memberIdSchema, flightNumber: flightNumberSchema }),
  execute: async ({ memberId, flightNumber }, ctx) => {
    // Guardrail enforced in code, not prompt: a claim can only be filed in a
    // run where checkPolicyCoverage already returned eligible=true for the
    // same member + flight. A prompt-injected "file it now" cannot skip this.
    const traceId = ctx?.requestContext?.get(TRACE_KEY) as string | undefined;
    const checked = traceId
      ? toolCalls(getTrace(traceId)).some(
          (c) => c.tool === "checkPolicyCoverage" && (c.input as any)?.memberId === memberId && (c.input as any)?.flightNumber === flightNumber && (c.output as any)?.eligible === true,
        )
      : false;
    if (!checked) {
      return { filed: false as const, reason: "COVERAGE_NOT_CHECKED", message: "Coverage has not been confirmed in this conversation. Call checkPolicyCoverage first and only file if eligible=true." };
    }
    const member = MEMBERS[memberId];
    if (!member?.policyId) return { filed: false as const, reason: "NO_POLICY", message: `No active policy for ${memberId}.` };
    const policy = POLICIES[member.policyId];
    const flight = FLIGHTS[flightNumber];
    if (!policy?.active || !flight) return { filed: false as const, reason: "NOT_ELIGIBLE", message: "Coverage check failed; run checkPolicyCoverage." };

    const duplicate = CLAIMS.find((c) => c.policyId === policy.policyId && c.flightNumber === flightNumber);
    if (duplicate) return { filed: false as const, reason: "DUPLICATE", message: `A claim (${duplicate.claimId}) already exists for ${flightNumber}.`, claimId: duplicate.claimId };

    let amountGbp: number;
    if (flight.status === "CANCELLED") amountGbp = policy.cancellationCoverGbp;
    else if (flight.status === "DELAYED" && flight.delayMinutes >= policy.delayThresholdMinutes) amountGbp = policy.delayPayoutGbp;
    else return { filed: false as const, reason: "NOT_ELIGIBLE", message: "Disruption does not meet the policy threshold." };

    const claim = {
      claimId: `CLM-${String(CLAIMS.length + 1).padStart(5, "0")}`,
      policyId: policy.policyId,
      flightNumber,
      amountGbp,
      status: "SUBMITTED",
      filedAt: new Date().toISOString(),
    };
    CLAIMS.push(claim);
    return { filed: true as const, ...claim, message: "Claim submitted. Payment typically arrives within 5 working days." };
  },
});

export const claimsTools = { checkPolicyCoverage, fileDelayClaim };
