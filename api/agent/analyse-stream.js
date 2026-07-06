import { readBody } from "../../lib/read-body.js";
import { normalizeServiceUrl } from "../../lib/agent-url.js";

const AGENT_URL = normalizeServiceUrl(process.env.AGENT_SERVICE_URL, "http://localhost:8000");
const TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || "120000", 10);
const FALLBACK = ["1", "true", "yes"].includes(String(process.env.AGENT_FALLBACK || "1").toLowerCase());

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const body = await readBody(req);
  const payload = {
    prospect: body.prospect || {},
    openerKeys: body.openerKeys || [],
    extraContext: body.extraContext || "",
    deep: !!body.deep,
    pullProfile: !!body.pullProfile,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(`${AGENT_URL}/v1/analyse/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      throw new Error(errText || `Agent HTTP ${upstream.status}`);
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    if (!res.writableEnded) res.end();
  } catch (e) {
    if (FALLBACK) {
      console.warn("[agent] analyse-stream fallback:", e.message);
      req.body = body;
      const legacy = await import("../ai/analyse.js");
      return legacy.default(req, res);
    }
    if (!res.headersSent) {
      res.status(502).json({ error: e.message || "Agent stream unavailable" });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", message: e.message })}\n\n`);
      res.end();
    }
  } finally {
    clearTimeout(timer);
  }
}
