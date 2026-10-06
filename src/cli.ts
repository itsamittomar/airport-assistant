import readline from "node:readline/promises";
import { runConcierge, type Turn } from "./run.js";
import { shutdown } from "./mastra.js";

const MAX_HISTORY_TURNS = 20;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let history: Turn[] = [];

console.log("Airport Concierge — type a question, 'reset' to start a new conversation, or 'exit'.\n");
for (;;) {
  let q: string;
  try {
    q = (await rl.question("you> ")).trim();
  } catch {
    break; // stdin closed (piped input ended)
  }
  if (!q || q === "exit") break;
  if (q === "reset") {
    history = [];
    console.log("(conversation cleared)\n");
    continue;
  }
  const r = await runConcierge(q, { history });
  if (r.error) {
    console.log(`error: ${r.error}\n`);
    continue;
  }
  console.log(`\nconcierge> ${r.text}\n   [via ${r.delegatedTo.join(", ") || "no delegation"}${r.guardrails ? `; guardrails: ${r.guardrails.join(", ")}` : ""}]\n`);
  history.push({ role: "user", content: q }, { role: "assistant", content: r.text });
  if (history.length > MAX_HISTORY_TURNS * 2) history = history.slice(-MAX_HISTORY_TURNS * 2);
}
rl.close();
await shutdown();
