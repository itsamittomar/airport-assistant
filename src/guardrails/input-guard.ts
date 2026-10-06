import type { Processor, ProcessInputArgs, ProcessInputResult } from "@mastra/core/processors";

/**
 * Deterministic input guardrail, run before the orchestrator's model sees the
 * message. Enforced in code, not in the prompt, so the model cannot be talked
 * out of it.
 *
 * Blocks:
 *  - prompt-injection attempts ("ignore previous instructions", "you are now…")
 *  - attempts to extract the system prompt / rules / guardrails
 *  - oversized inputs (cost + context-stuffing protection)
 *
 * On a hit it trips Mastra's tripwire with a user-facing message; run.ts turns
 * that into the final answer and records which rule fired.
 */
export const CAPABILITY_STATEMENT =
  "I can help with flight status and rebooking, airport lounge access, and travel insurance claims for a disrupted trip. I can't share my internal configuration. What can I help you with?";

export const INJECTION_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "ignore-instructions", pattern: /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|all|your)\b[^.]{0,20}\b(instructions?|rules?|prompt|guidelines?)/i },
  { name: "role-hijack", pattern: /\b(you are now|act as|pretend (to be|you are)|from now on you)\b/i },
  { name: "developer-mode", pattern: /\b(developer|debug|god|jailbreak|dan) mode\b/i },
  { name: "prompt-extraction", pattern: /\b(show|reveal|print|display|tell|give|repeat|list|what are|what is|describe|explain)\b[^.]{0,40}\b(system prompt|instructions|guardrails?|hidden rules|your rules|your prompt|your configuration|internal (rules|config|instructions))/i },
];

export const MAX_INPUT_CHARS = 2000;

export function detectInjection(text: string): string | undefined {
  return INJECTION_PATTERNS.find((p) => p.pattern.test(text))?.name;
}

/** Pull plain text out of a Mastra message regardless of content format. */
export function messageText(msg: any): string {
  const c = msg?.content;
  if (typeof c === "string") return c;
  if (typeof c?.content === "string") return c.content;
  const parts = Array.isArray(c?.parts) ? c.parts : Array.isArray(c) ? c : [];
  return parts
    .filter((p: any) => p?.type === "text" && typeof p.text === "string")
    .map((p: any) => p.text)
    .join("\n");
}

export class InputGuard implements Processor<"input-guard"> {
  readonly id = "input-guard" as const;
  readonly name = "Input guardrail";

  processInput({ messages, abort }: ProcessInputArgs): ProcessInputResult {
    const latestUser = [...messages].reverse().find((m) => m.role === "user");
    if (!latestUser) return messages;
    const text = messageText(latestUser);

    if (text.length > MAX_INPUT_CHARS) {
      abort(`Your message is too long (${text.length} characters). Please keep it under ${MAX_INPUT_CHARS}.`, {
        metadata: { rule: "max-length" },
      });
    }
    const rule = detectInjection(text);
    if (rule) {
      abort(CAPABILITY_STATEMENT, { metadata: { rule } });
    }
    return messages;
  }
}
