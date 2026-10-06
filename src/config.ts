import "dotenv/config";

/**
 * Central runtime configuration.
 *
 * Mastra's model router resolves "<provider>/<model>" strings itself and reads
 * the provider's standard env var (OPENROUTER_API_KEY, ANTHROPIC_API_KEY,
 * OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY). OpenRouter is the default
 * because one key covers every model; a reviewer without an OpenRouter key can
 * set MODEL_PROVIDER (or just set a different provider's key) instead.
 */
const openRouterKey = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY;
if (openRouterKey && !process.env.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY = openRouterKey;

type Provider = "openrouter" | "anthropic" | "openai" | "google";

const PROVIDERS: Record<Provider, { keyEnv: string; defaultModel: string }> = {
  openrouter: { keyEnv: "OPENROUTER_API_KEY", defaultModel: "anthropic/claude-haiku-4.5" },
  anthropic: { keyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-haiku-4-5" },
  openai: { keyEnv: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini" },
  google: { keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY", defaultModel: "gemini-2.5-flash" },
};
// Mastra also accepts GOOGLE_API_KEY for Google; normalise so detection below is uniform.
if (process.env.GOOGLE_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
}

function pickProvider(): Provider {
  const explicit = process.env.MODEL_PROVIDER?.toLowerCase() as Provider | undefined;
  if (explicit) {
    if (!(explicit in PROVIDERS)) throw new Error(`Unknown MODEL_PROVIDER "${explicit}". Use one of: ${Object.keys(PROVIDERS).join(", ")}`);
    return explicit;
  }
  // Auto-detect: first provider whose key is present, OpenRouter preferred.
  for (const p of Object.keys(PROVIDERS) as Provider[]) {
    if (process.env[PROVIDERS[p].keyEnv]) return p;
  }
  return "openrouter";
}

const provider = pickProvider();
const { keyEnv, defaultModel } = PROVIDERS[provider];

export const config = {
  provider,
  hasApiKey: Boolean(process.env[keyEnv]),
  /** Model used by every agent. Must support tool calling. */
  model: `${provider}/${process.env.MODEL ?? defaultModel}`,
  /** Cheaper model for the LLM-as-judge step in evals (can be the same). */
  judgeModel: `${provider}/${process.env.JUDGE_MODEL ?? process.env.MODEL ?? defaultModel}`,
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
      `No API key found for provider "${provider}". Set ${keyEnv} in .env` +
        (provider === "openrouter" ? " (OPEN_ROUTER_KEY is also accepted)" : "") +
        ", or set ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY to use that provider directly — see .env.example",
    );
  }
}
