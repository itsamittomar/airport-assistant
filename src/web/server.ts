import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runConcierge, type Turn } from "../run.js";
import { shutdown } from "../mastra.js";

/**
 * Minimal local web UI. Deliberately dependency-free (Node `http` only):
 * one static page plus one JSON endpoint over the same `runConcierge` entry
 * point the CLI and evals use. The browser owns the conversation history and
 * sends it with each request, so the server is stateless and multiple tabs
 * never share or corrupt a conversation.
 */
const PORT = Number(process.env.PORT ?? 3000);
const MAX_HISTORY_TURNS = 20;
const MAX_MESSAGE_CHARS = 4000;
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isTurn(t: unknown): t is Turn {
  return !!t && typeof t === "object" && ((t as any).role === "user" || (t as any).role === "assistant") && typeof (t as any).content === "string";
}

export async function handleChat(body: unknown) {
  const message = typeof (body as any)?.message === "string" ? (body as any).message.trim() : "";
  if (!message) return { status: 400, payload: { error: "message is required" } };
  if (message.length > MAX_MESSAGE_CHARS) return { status: 400, payload: { error: `message exceeds ${MAX_MESSAGE_CHARS} characters` } };
  const rawHistory = Array.isArray((body as any)?.history) ? (body as any).history : [];
  const history: Turn[] = rawHistory.filter(isTurn).slice(-MAX_HISTORY_TURNS * 2);

  const r = await runConcierge(message, { history });
  return {
    status: r.error ? 502 : 200,
    payload: {
      text: r.text,
      error: r.error,
      delegatedTo: r.delegatedTo,
      guardrails: r.guardrails ?? [],
      durationMs: r.durationMs,
      toolCalls: r.trace
        .filter((e) => e.kind === "tool")
        .map((e: any) => ({ agent: e.agent, tool: e.tool, ok: e.ok, durationMs: e.durationMs })),
    },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/chat") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : "invalid JSON" });
      }
      const { status, payload } = await handleChat(body);
      return json(res, status, payload);
    }
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const html = await readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`Airport Concierge web chat: http://localhost:${PORT}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    server.close();
    await shutdown();
    process.exit(0);
  });
}
