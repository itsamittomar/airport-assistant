import { mkdirSync, writeFileSync } from "node:fs";
import { Agent } from "@mastra/core/agent";
import { CASES, type EvalCase } from "./cases.js";
import { runConcierge, type RunResult } from "../src/run.js";
import { shutdown } from "../src/mastra.js";
import { config } from "../src/config.js";
import { toolCalls } from "../src/trace.js";

/**
 * Evaluation runner.
 *
 * For every case we run the real system, then apply two layers of checks:
 *  1. Deterministic trace assertions (delegation, tool use, forbidden tools,
 *     regex on the answer). These are the regression gate.
 *  2. LLM-as-judge faithfulness: the judge sees the user prompt, the raw tool
 *     outputs from the trace, and the final answer, and scores whether the
 *     answer is grounded in those outputs. Catches hallucinated facts that a
 *     regex cannot.
 *
 * Usage: npm run eval [-- --case <id>] [--no-judge]
 * Exit code 1 on any failure so CI can gate on it.
 */
const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : undefined;
const noJudge = args.includes("--no-judge");
const JUDGE_FAIL_BELOW = Number(process.env.JUDGE_FAIL_BELOW ?? 3);

interface Check { name: string; pass: boolean; detail?: string }
interface CaseReport { id: string; pass: boolean; checks: Check[]; judge?: { faithfulness: number; helpfulness: number; issues: string[] }; durationMs: number; delegatedTo: string[]; toolsCalled: string[]; answer: string; error?: string }

const judge = new Agent({
  id: "judge",
  name: "Eval Judge",
  instructions: `You grade an AI travel concierge. You are given the user's message, the raw outputs of every tool that ran, and the concierge's final answer.
Score 1-5:
- faithfulness: every factual claim in the answer (statuses, times, lounge names, amounts, eligibility) is supported by the tool outputs. Any invented or contradicted fact => 2 or lower. Hedged wording when data is missing is fine.
- helpfulness: the answer addresses what was asked, concisely, with sensible next steps.
Respond with ONLY a JSON object: {"faithfulness": n, "helpfulness": n, "issues": ["..."]}`,
  model: config.judgeModel,
});

function checkCase(c: EvalCase, r: RunResult): Check[] {
  const checks: Check[] = [];
  const calls = toolCalls(r.trace);
  const called = calls.map((t) => `${t.agent}.${t.tool}`);

  checks.push({ name: "no runtime error", pass: !r.error, detail: r.error });
  for (const d of c.delegates ?? []) checks.push({ name: `delegates to ${d}`, pass: r.delegatedTo.includes(d), detail: `delegated: [${r.delegatedTo}]` });
  for (const d of c.notDelegates ?? []) checks.push({ name: `does not delegate to ${d}`, pass: !r.delegatedTo.includes(d), detail: `delegated: [${r.delegatedTo}]` });
  for (const t of c.tools ?? []) {
    const n = called.filter((x) => x === `${t.agent}.${t.tool}`).length;
    const min = t.minCount ?? 1;
    checks.push({ name: `${t.agent} calls ${t.tool}${min > 1 ? ` >=${min}x` : ""}`, pass: n >= min, detail: `called: [${called}]` });
  }
  for (const f of c.forbiddenTools ?? []) checks.push({ name: `never calls ${f}`, pass: !calls.some((t) => t.tool === f), detail: `called: [${called}]` });
  for (const re of c.text ?? []) checks.push({ name: `answer matches ${re}`, pass: re.test(r.text) });
  for (const re of c.notText ?? []) checks.push({ name: `answer does not match ${re}`, pass: !re.test(r.text) });
  if (c.maxDelegations !== undefined) checks.push({ name: `<= ${c.maxDelegations} delegations`, pass: r.delegatedTo.length <= c.maxDelegations, detail: `${r.delegatedTo.length}` });
  checks.push({ name: "all tool calls succeeded", pass: calls.every((t) => t.ok), detail: calls.filter((t) => !t.ok).map((t) => `${t.tool}: ${JSON.stringify(t.output).slice(0, 120)}`).join("; ") });
  return checks;
}

async function runJudge(c: EvalCase, r: RunResult) {
  const evidence = toolCalls(r.trace).map((t) => ({ agent: t.agent, tool: t.tool, input: t.input, output: t.output }));
  const prompt = `USER MESSAGE:\n${c.prompt}\n\nTOOL OUTPUTS (ground truth):\n${JSON.stringify(evidence, null, 1)}\n\nFINAL ANSWER:\n${r.text}`;
  try {
    const res = await judge.generate(prompt);
    const m = res.text.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m?.[0] ?? "{}");
    return { faithfulness: Number(j.faithfulness ?? 0), helpfulness: Number(j.helpfulness ?? 0), issues: Array.isArray(j.issues) ? j.issues.map(String) : [] };
  } catch (err) {
    return { faithfulness: 0, helpfulness: 0, issues: [`judge failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

const cases = only ? CASES.filter((c) => c.id === only) : CASES;
if (cases.length === 0) {
  console.error(`No case named ${only}`);
  process.exit(2);
}

const reports: CaseReport[] = [];
console.log(`Running ${cases.length} eval case(s) with model ${config.model}${noJudge ? " (judge disabled)" : ""}\n`);

for (const c of cases) {
  process.stdout.write(`▶ ${c.id} ... `);
  const r = await runConcierge(c.prompt);
  const checks = checkCase(c, r);
  const judgeResult = !noJudge && c.judge && !r.error ? await runJudge(c, r) : undefined;
  if (judgeResult) checks.push({ name: `judge faithfulness >= ${JUDGE_FAIL_BELOW}`, pass: judgeResult.faithfulness >= JUDGE_FAIL_BELOW, detail: judgeResult.issues.join("; ") });
  const pass = checks.every((k) => k.pass);
  reports.push({ id: c.id, pass, checks, judge: judgeResult, durationMs: r.durationMs, delegatedTo: r.delegatedTo, toolsCalled: toolCalls(r.trace).map((t) => `${t.agent}.${t.tool}`), answer: r.text, error: r.error });
  console.log(pass ? "PASS" : "FAIL", `(${(r.durationMs / 1000).toFixed(1)}s${judgeResult ? `, faithfulness ${judgeResult.faithfulness}/5` : ""})`);
  for (const k of checks.filter((k) => !k.pass)) console.log(`    ✗ ${k.name}${k.detail ? ` — ${k.detail}` : ""}`);
}

await shutdown();

const passed = reports.filter((r) => r.pass).length;
const totalChecks = reports.reduce((n, r) => n + r.checks.length, 0);
const passedChecks = reports.reduce((n, r) => n + r.checks.filter((k) => k.pass).length, 0);
const judged = reports.filter((r) => r.judge);
const avgFaith = judged.length ? (judged.reduce((n, r) => n + r.judge!.faithfulness, 0) / judged.length).toFixed(2) : "n/a";

console.log(`\n${"=".repeat(60)}\nCases: ${passed}/${reports.length} passed   Checks: ${passedChecks}/${totalChecks}   Avg faithfulness: ${avgFaith}`);

mkdirSync("evals/results", { recursive: true });
const summary = { model: config.model, at: new Date().toISOString(), cases: reports.length, passed, checks: totalChecks, passedChecks, avgFaithfulness: avgFaith, reports };
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`evals/results/${stamp}.json`, JSON.stringify(summary, null, 2));
writeFileSync(`evals/results/latest.json`, JSON.stringify(summary, null, 2));
console.log(`Report: evals/results/latest.json`);

process.exit(passed === reports.length ? 0 : 1);
