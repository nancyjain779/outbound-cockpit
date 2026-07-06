import { readBody } from "../../lib/read-body.js";
import { normalizeServiceUrl } from "../../lib/agent-url.js";

const AGENT_URL = normalizeServiceUrl(process.env.AGENT_SERVICE_URL, "http://localhost:8000");
const TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || "120000", 10);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const body = await readBody(req);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${AGENT_URL}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospect_id: body.prospect_id || body.prospect?.id || "",
        message: body.message || "",
        prospect: body.prospect || {},
        openerKeys: body.openerKeys || [],
      }),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || data.error || `Agent HTTP ${r.status}`);
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || "Agent chat unavailable" });
  } finally {
    clearTimeout(timer);
  }
}
