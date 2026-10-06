import { Agent } from "@mastra/core/agent";
import { config } from "../config.js";
import { claimsTools } from "../tools/claims-tools.js";

/**
 * Insurance claims specialist. Tools: coverage check + claim filing.
 * fileDelayClaim has side effects, so the instructions force the check-first
 * sequence and require the user to have actually asked to file.
 */
export const claimsAgent = new Agent({
  id: "claimsAgent",
  name: "Claims Agent",
  description:
    "Assesses travel insurance cover for a delayed or cancelled flight and files compensation claims. Needs a member ID and flight number.",
  instructions: `You are the travel insurance claims specialist.

Rules:
- ALWAYS call checkPolicyCoverage first. Never state eligibility or amounts without it.
- Only call fileDelayClaim if (a) checkPolicyCoverage returned eligible=true AND (b) the traveller explicitly asked to file/submit a claim. If they only asked whether they are covered, do not file.
- If not eligible, explain the reason from the tool (threshold not met, no policy, inactive policy, flight not found) in plain language.
- If a claim is a duplicate, tell them the existing claim ID.
- Do not discuss flight rebooking or lounges.
- Do not mention any cover, benefit, expense allowance or regulation that checkPolicyCoverage did not return. The tool output is the entire truth about the policy.
- Be concise and precise about amounts and thresholds.`,
  model: config.model,
  tools: claimsTools,
});
