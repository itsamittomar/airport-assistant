import type { Processor, ProcessOutputResultArgs, ProcessorMessageResult } from "@mastra/core/processors";
import { CAPABILITY_STATEMENT } from "./input-guard.js";

/**
 * Deterministic output guardrail on the orchestrator's final answer.
 *
 *  1. Instruction leakage: if the answer contains phrases that only exist in
 *     our system prompts, the whole answer is replaced with the capability
 *     statement. (The input guard catches direct asks; this catches indirect
 *     ones and model drift.)
 *  2. PII masking: card numbers and email addresses are redacted. The service
 *     never needs them and they must not be echoed back or logged.
 */
export const LEAK_MARKERS: RegExp[] = [
  /delegation rules/i,
  /you are the airport concierge/i,
  /never (cite|file an insurance claim unless)/i,
  /specialists? (look those up|did not report)/i,
  /\bflightAgent\b|\bloungeAgent\b|\bclaimsAgent\b/,
  /\b(getFlightStatus|findLounges|checkLoungeAccess|checkPolicyCoverage|fileDelayClaim)\b/,
];

export const PII_RULES: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: "card-number", pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: "[card number redacted]" },
  { name: "email", pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: "[email redacted]" },
];

export function guardOutputText(text: string): { text: string; violations: string[] } {
  const violations: string[] = [];
  if (LEAK_MARKERS.some((re) => re.test(text))) {
    return { text: CAPABILITY_STATEMENT, violations: ["instruction-leak"] };
  }
  let out = text;
  for (const rule of PII_RULES) {
    if (rule.pattern.test(out)) {
      violations.push(rule.name);
      out = out.replace(rule.pattern, rule.replacement);
    }
    rule.pattern.lastIndex = 0;
  }
  return { text: out, violations };
}

export class OutputGuard implements Processor<"output-guard"> {
  readonly id = "output-guard" as const;
  readonly name = "Output guardrail";

  processOutputResult({ messages, requestContext }: ProcessOutputResultArgs): ProcessorMessageResult {
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      const parts: any[] = (msg.content as any)?.parts ?? [];
      for (const part of parts) {
        if (part?.type !== "text" || typeof part.text !== "string") continue;
        const { text, violations } = guardOutputText(part.text);
        if (violations.length) {
          part.text = text;
          const prev = (requestContext?.get("guardrailViolations") as string[] | undefined) ?? [];
          requestContext?.set("guardrailViolations", [...prev, ...violations.map((v) => `output:${v}`)]);
        }
      }
      if (typeof (msg.content as any)?.content === "string") {
        const { text, violations } = guardOutputText((msg.content as any).content);
        if (violations.length) (msg.content as any).content = text;
      }
    }
    return messages;
  }
}
