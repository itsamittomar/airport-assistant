import "dotenv/config";

/**
 * Central runtime configuration.
 *
 * Mastra's model router resolves "openrouter/<model>" strings itself and reads
 * OPENROUTER_API_KEY. The .env in this repo uses OPEN_ROUTER_KEY, so we accept
 * both and normalise before any agent is constructed.
 */
const key = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY;
if (key && !process.env.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY = key;

export const config = {
  hasApiKey: Boolean(key),
  /** Model used by every agent. Must support tool calling. */
  model: `openrouter/${process.env.MODEL ?? "anthropic/claude-haiku-4.5"}`,
  /** Cheaper model for the LLM-as-judge step in evals (can be the same). */
  judgeModel: `openrouter/${process.env.JUDGE_MODEL ?? process.env.MODEL ?? "anthropic/claude-haiku-4.5"}`,
  /** Hard cap on orchestrator steps so a confused model cannot loop forever. */
  maxSteps: Number(process.env.MAX_STEPS ?? 8),
  /** Per-tool timeout (ms) — applies to MCP calls which hit the network. */
  toolTimeoutMs: Number(process.env.TOOL_TIMEOUT_MS ?? 15_000),
  /** Set MCP_DISABLED=1 to run fully offline (weather tools report unavailable). */
  mcpDisabled: process.env.MCP_DISABLED === "1",
};

export function assertApiKey(): void {
  if (!config.hasApiKey) {
    throw new Error(
      "No OpenRouter key found. Set OPEN_ROUTER_KEY (or OPENROUTER_API_KEY) in .env — see .env.example",
    );
  }
}
