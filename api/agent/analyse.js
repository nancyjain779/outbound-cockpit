import { readBody } from "../../lib/read-body.js";
import { normalizeServiceUrl } from "../../lib/agent-url.js";

const AGENT_URL = normalizeServiceUrl(process.env.AGENT_SERVICE_URL, "http://localhost:8000");
const TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || "120000", 10);
const FALLBACK = ["1", "true", "yes"].includes(String(process.env.AGENT_FALLBACK || "1").toLowerCase());

async function proxyToAgent(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${AGENT_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || data.error || `Agent HTTP ${r.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const body = await readBody(req);
  try {
    const data = await proxyToAgent("/v1/analyse", {
      prospect: body.prospect || {},
      openerKeys: body.openerKeys || [],
      extraContext: body.extraContext || "",
      deep: !!body.deep,
      pullProfile: !!body.pullProfile,
    });
    res.status(200).json(data);
  } catch (e) {
    if (FALLBACK) {
      req.body = body;
      const legacy = await import("../ai/analyse.js");
      console.warn("[agent] analyse fallback:", e.message);
      return legacy.default(req, res);
    }
    res.status(502).json({ error: e.message || "Agent unavailable", tool_trace: [] });
  }
}
