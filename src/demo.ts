import { runConcierge } from "./run.js";
import { shutdown } from "./mastra.js";
import { toolCalls } from "./trace.js";

const prompt =
  process.argv.slice(2).join(" ") ||
  "I'm member PP-1001 on BA117 today. Is it delayed? If so, where can I wait at the airport and am I covered for compensation?";

console.log(`\n> ${prompt}\n`);
const r = await runConcierge(prompt);
if (r.error) console.error(`ERROR: ${r.error}`);
console.log(r.text);
console.log("\n--- trace ---");
console.log(`delegated to: ${r.delegatedTo.join(" -> ") || "(none)"}`);
if (r.guardrails) console.log(`guardrails fired: ${r.guardrails.join(", ")}`);
for (const c of toolCalls(r.trace)) console.log(`${c.ok ? "ok " : "ERR"} ${c.agent}.${c.tool}(${JSON.stringify(c.input)}) ${c.durationMs}ms`);
console.log(`steps=${r.steps} duration=${r.durationMs}ms`);
await shutdown();
