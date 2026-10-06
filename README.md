# Airport Concierge — multi-agent travel disruption assistant

A small agentic system for a traveller whose flight has just gone wrong. One orchestrating
**concierge** agent delegates to three specialists — **flight**, **lounge** and **insurance claims** —
each with its own narrowly scoped tools, including a real external MCP server for live weather.

Built with TypeScript, [Mastra](https://mastra.ai), and OpenRouter. The domain maps to Collinson's
Priority Pass / travel-insurance businesses, but the data is mocked.

```
"I'm member PP-1001 on BA117 today. Is it delayed? If so, where can I
 wait at the airport and am I covered for compensation?"

 concierge ──► flightAgent  ──► getFlightStatus          (mock airline ops)
           │                └► weather_get_weather       (open-meteo MCP, live)
           ├─► loungeAgent  ──► findLounges, checkLoungeAccess
           └─► claimsAgent  ──► checkPolicyCoverage  (✗ fileDelayClaim — not asked)
```

---

## Running it

```bash
npm install
cp .env.example .env            # add your OpenRouter key (OPEN_ROUTER_KEY=...)
npm run demo                    # the scenario above, with an execution trace
npm run demo -- "Is EK5 on time?"
npm run chat                    # interactive REPL with conversation history ('reset' clears it)
npm run web                     # browser chat UI at http://localhost:3000 (PORT= to change)
npm test                        # unit + contract + guardrail tests (no LLM calls, ~0.5s)
npm run eval                    # 13 behavioural eval cases against the live system (~2 min)
npm run eval -- --case explicit-file-claim --no-judge
npm run typecheck
```

**Model.** Any OpenRouter model with tool calling works; the default is `anthropic/claude-haiku-4.5`
(set `MODEL=` in `.env`). Mastra's model router resolves the `openrouter/...` string directly, so
there is no provider SDK to version-match. Judge model can be set separately with `JUDGE_MODEL=`.

**MCP server.** The flight agent connects over stdio to [`open-meteo-mcp`](https://www.npmjs.com/package/open-meteo-mcp)
(spawned with `npx -y open-meteo-mcp`, no API key). Set `MCP_DISABLED=1` to run offline; the weather
tools then return a structured "unavailable" result instead of breaking the agent.

Node ≥ 20. No database, no network beyond OpenRouter and Open-Meteo.

**Web chat.** `npm run web` serves a single-page chat UI (`public/index.html`) from a dependency-free
Node `http` server (`src/web/server.ts`). It exposes one endpoint, `POST /api/chat`, which calls the
same `runConcierge` entry point as the CLI and evals. The browser keeps the conversation history and
sends it with each request, so the server is stateless and tabs never share state. Each reply shows
which sub-agents handled it, the tool calls made, elapsed time, and any guardrail that fired.

---

## Architecture and key decisions

### Agents and the division of responsibility

| Agent | Responsibility | Tools | Why these tools and no others |
|---|---|---|---|
| **concierge** (orchestrator) | Understand the traveller, decide which specialists are needed, sequence them, merge answers | *none* — only the three sub-agents | If the concierge had domain tools it could answer without delegating, which makes routing unobservable. With zero tools, every fact must come from a specialist, so a missing delegation is a visible bug. |
| **flightAgent** | Status, delays, gates, rebooking, weather at origin/destination | `getFlightStatus`, `findRebookingOptions` (mock) + `weather_get_weather`, `weather_get_weather_alerts` (MCP) | Weather is the top cause of disruption and the only thing our mock airline data cannot know, so the external integration belongs here. It gets 2 of the MCP server's 5 tools — least privilege applies to MCP tools too. |
| **loungeAgent** | Find lounges, check entitlement (tier, visits left, capacity, guest fees) | `findLounges`, `checkLoungeAccess` | Needs airport/terminal, which the concierge passes from the flight agent's answer. Cannot see flights or policies. |
| **claimsAgent** | Assess cover, file claims | `checkPolicyCoverage`, `fileDelayClaim` | `fileDelayClaim` has a side effect, so it lives behind the one agent whose instructions enforce *check first, file only on explicit request*. |

Mastra exposes each sub-agent to the orchestrator as a tool named `agent-<key>`; the concierge
calls it with a natural-language `prompt`. Information flows **concierge → specialist** as that
prompt (e.g. "BA117 is delayed 195 min at LHR T5; member PP-1001 — can they enter a lounge?") and
**specialist → concierge** as the specialist's final text. The concierge is told to get flight
status first and feed the facts to the other two, because lounge and claims decisions depend on them.

### Delegation: when and how

Delegation is model-driven (the concierge decides from its instructions), not hard-coded. I chose
that over a deterministic workflow because the interesting requests are mixed ("where can I wait
*and* am I covered") and the set of specialists needed is only known after reading the message.
The cost is non-determinism, which is exactly what the evals exist to measure. A production
version would likely add a classifier/workflow for the high-volume single-intent paths and keep
the LLM router for the long tail.

### Tools

All tools are built with one wrapper, `tracedTool` (`src/tools/traced.ts`), which gives every tool:

- **Ownership** — the agent the tool belongs to is recorded at definition time, so evals can
  assert *who* called *what*.
- **Error normalisation** — a thrown error becomes `{ error: true, message }`. The agent loop
  never crashes; the model explains the failure to the user.
- **Timeouts** — bounded wait for anything that hits the network (the MCP calls).
- **Tracing** — input, output, duration and success are appended to a per-run trace.

Tools return structured "not found" / "not eligible" results rather than throwing, with a
`reason` code the agent is instructed to relay. Input schemas (zod) validate and normalise
identifiers (`ba117` → `BA117`, member IDs must match `PP-\d{4}`), so the model can't pass junk.

MCP tools are re-wrapped with the same `tracedTool`, so an MCP call looks identical to a local
call in the trace.

### Tracing

`src/trace.ts` is a tiny in-process trace store keyed by a `traceId` placed in Mastra's
`RequestContext`. Mastra forwards the parent request context to sub-agents, so a tool three
levels deep can find the run it belongs to. Delegations are captured in the orchestrator's
`onStepFinish` hook by spotting `agent-*` tool calls. This is what `runConcierge()` returns
alongside the answer — the demo prints it and the evals assert on it.

### Guardrails

Guardrails are enforced in **code**, not only in prompts, so the model cannot be talked out of them
(`src/guardrails/`). They run as Mastra input/output processors on the orchestrator.

| Layer | What it does | Where |
|---|---|---|
| Input processor | Blocks prompt-injection ("ignore previous instructions", "you are now…", "developer mode") and prompt-extraction ("show me your guardrails / system prompt") *before* the model runs; caps input length. Trips Mastra's tripwire with a fixed capability statement. | `InputGuard` |
| Output processor | Replaces any answer that leaks instruction text (phrases that only exist in our system prompts, tool or agent names); redacts card numbers and emails. | `OutputGuard` |
| Tool-level | `fileDelayClaim` refuses unless `checkPolicyCoverage` returned `eligible=true` for the same member and flight **in the same run** (checked against the trace). A prompt-injected "file it now" cannot skip the check even if it reached the model. | `claims-tools.ts` |
| Loop cap | `maxSteps` on the orchestrator. | `config.ts` |

A guardrail hit is reported on `RunResult.guardrails` (e.g. `input:prompt-extraction`,
`output:email`) and printed by the demo and CLI, so evals can assert on it. Blocked requests
return in ~0.1s with no model cost.

### Conversation history

`runConcierge(prompt, { history })` accepts prior turns, and the CLI keeps them (last 20), so
follow-ups like *"yes please find lounge"* or a bare *"JFK, PP-2002"* resolve against what was just
discussed. History lives in the caller rather than a memory store, so each run is still stateless
and the evals stay reproducible. Mastra Memory would replace this in production.

---

## Evaluation approach

The brief asks how we'd know the *system* behaves correctly, not just whether the text reads well.
So the eval (`evals/`) asserts on the trace first and the text second.

**Behaviours I consider important** (each has at least one case in `evals/cases.ts`):

| Behaviour | How it is checked |
|---|---|
| Correct specialist chosen | `delegates` / `notDelegates` on the orchestrator's delegation list |
| Right tools, by the right agent | `tools: [{ agent, tool, minCount }]` — the lounge agent, not the flight agent, called `findLounges` |
| No side effects without consent | `forbiddenTools: ["fileDelayClaim"]` on every "am I covered?" case |
| No guessing identifiers | Without a member ID, `checkLoungeAccess` must not be called and the answer must ask for one |
| Scope control | Off-topic request: zero delegations, zero tools |
| No fabrication | Regex guards (`notText`) for known hallucinations seen during development (EU261, meal allowances) **plus** an LLM judge |
| Graceful failure | `all tool calls succeeded` check, and the MCP-disabled contract test |
| Guardrails hold | Prompt-extraction and injection cases: zero delegations, no leaked phrases, `fileDelayClaim` never called |
| Edge cases in business logic | Unknown flight, full lounge, below-threshold delay, duplicate claim |

**LLM-as-judge.** Regexes can't catch "I said Aspire is free when I never checked it". The judge
receives the user message, the *raw tool outputs from the trace* as ground truth, and the final
answer, and scores faithfulness and helpfulness 1–5. It fails a case below 3 (`JUDGE_FAIL_BELOW`).
Judge scores are noisier than trace assertions, so the deterministic checks remain the regression
gate; the judge is the hallucination detector.

**Detecting regressions.** `npm run eval` exits non-zero on any failed case, prints the failed
check with the actual delegation/tool list, and writes a JSON report (`evals/results/latest.json`
plus a timestamped copy) with per-case scores so runs can be diffed over time. In CI this would
run on every change to agent instructions, tool descriptions or the model, with the pass rate and
average faithfulness tracked as a time series.

**What the eval found during this exercise** (all now fixed, see git history):

1. Mastra's `result.text` concatenates every step's narration, producing answers like *"I need to
   pause and check first… Great news, your claim is filed!"*. The judge scored it 2/5. Fix: return
   the final step's text only.
2. The claims agent invented a "meals after 2 hours" benefit and the concierge cited UK261 — neither
   came from a tool. Fix: instructions now forbid citing anything a tool didn't return; regex guards
   added so it can't silently come back.
3. The concierge asked for a "booking reference" and "tier" it didn't need. Fix: told it exactly
   which identifiers the specialists require.
4. The lounge agent recommended an alternative lounge without checking access to it. Fix: instruction
   plus a `minCount: 2` assertion on `checkLoungeAccess`.

Run history during the exercise (same 11 cases, deterministic checks / judge):

| Run | Cases | Checks | Avg faithfulness | What changed before it |
|---|---|---|---|---|
| 1 | 8/11 | 88/95 | 4.44 | first run |
| 2 | 9/11 | 97/99 | 4.33 | final-step text, anti-fabrication rules, identifier rules |
| 3 | 10/11 | 97/99 | 5.00 | lounge fallback check, weather wording |
| 4 | 9/11 | 94/99 | 4.89 | weather tool description — exposed two *new* variance failures |
| 5 | 10/11 | 98/99 | 4.56 | short flight numbers, regex fix |
| 6 | 13/13 | 111/111 | 4.89 | guardrail processors, claim sequence guard, conversation history, "act don't ask" rules; 2 guardrail cases added |

The flaky case across runs is `weather-via-mcp`: the model has summarised "Partly cloudy /
Overcast" from the live MCP output as "clear" (failed run 5, passed runs 3, 4 and 6). It is a
genuine non-deterministic grounding weakness that I'd rather have the eval report than loosen
the judge threshold to hide. See `DEVLOG.md` item 12 for the fix options I'd try next.

---

## Testing

`npm test` runs 47 vitest tests with no LLM calls:

- **Tool unit tests** (`tests/tools.test.ts`): every business-rule branch — unknown flight, full
  lounge, tier too low, no visits left, below threshold, duplicate claim, sold-out alternatives.
- **Wrapper tests** (`tests/traced.test.ts`): error → structured result, timeout, trace recording.
- **Contract tests** (`tests/agents.test.ts`): each agent exposes *exactly* its expected tools and the
  concierge has none; MCP-disabled fallback returns a clean error. If someone hands the lounge agent
  a claims tool, CI fails before any eval runs.
- **Guardrail tests** (`tests/guardrails.test.ts`): injection and extraction patterns trip, legitimate
  travel questions pass, output leak replacement and PII redaction, and the check-before-file
  sequence guard on `fileDelayClaim`.

The eval suite is the integration layer and is kept separate because it costs money and time.

---

## Failure handling

| Failure | Behaviour |
|---|---|
| Unknown flight / member / lounge | Tool returns `found=false` or a `reason` code; agent is instructed to relay it, not invent |
| MCP server won't start (no network, `npx` blocked, `MCP_DISABLED=1`) | Flight agent still builds; weather tools return `{ error, message }` |
| MCP tool call fails or times out (seen live: Open-Meteo 503) | Normalised to a structured error; run continues; eval records it |
| Model/API error | `runConcierge` returns `{ error }` instead of throwing, so a batch eval run completes |
| Model loops | `maxSteps` cap (default 8) |
| Bad identifiers from the model | zod schemas reject with a message the model can act on |
| Duplicate claim filing | Rejected with the existing claim ID |
| Filing without a coverage check (e.g. via injection) | `fileDelayClaim` returns `COVERAGE_NOT_CHECKED` |
| Prompt injection / prompt extraction | Blocked at input; fixed capability statement returned, no model call |
| Instruction leakage or PII in an answer | Output processor replaces / redacts before the user sees it |
| Missing API key | Clear startup error pointing at `.env.example` |

---

## Assumptions and limitations

- All airline, lounge, membership and policy data is in-memory mock data for one day (2026-10-06).
  Claims persist only for the process lifetime.
- Conversation history is held by the CLI and passed in per call; there is no persistent memory
  store, so context is lost when the process exits.
- Delegation is LLM-driven, so routing has some variance between runs. The eval is single-shot per
  case; a confident regression signal needs N runs per case.
- The weather eval depends on a live third-party API and inherits its availability.
- The LLM judge uses the same model family as the system under test, which is a known bias.
- No auth, rate limiting, PII handling or cost controls.

## What I would change for production

- **Deterministic fast paths**: a cheap intent classifier or Mastra workflow for single-intent
  requests; keep the LLM orchestrator for mixed requests.
- **Real observability**: ship the trace to Mastra's observability / OpenTelemetry instead of an
  in-memory map; attach trace IDs to user-facing errors.
- **Eval rigour**: run each case N times and report pass *rate*; a held-out judge model; a larger
  case set mined from real transcripts; thresholds in CI with trend dashboards.
- **Human-in-the-loop for side effects**: Mastra's `requireApproval` on `fileDelayClaim` so the
  claim is suspended until the traveller confirms, on top of the code-level sequence guard.
- **Stronger guardrails**: the regex-based injection detector is a first line only; add Mastra's
  LLM-backed `PromptInjectionDetector` / `PIIDetector` processors behind it, and track guardrail
  hit rates as an eval metric.
- **Memory and identity**: resolve the member from the authenticated session instead of asking for
  `PP-xxxx`; thread memory so follow-ups work.
- **Structured hand-offs**: have specialists return typed JSON (status, terminal, eligibility) to
  the orchestrator rather than prose, so downstream specialists get facts, not paraphrase.
- **Resilience**: retries with backoff for MCP/network tools, circuit breaker on the weather server,
  model fallback list in Mastra's model config.
