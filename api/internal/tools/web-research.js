import { readBody } from "../../../lib/read-body.js";
import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import { webResearch } from "../../../lib/web-research.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "web-research");

  const body = await readBody(req);
  const query = (body.query || "").trim();
  if (!query) { res.status(400).json({ error: "query required" }); return; }

  const result = await webResearch(query, { deep: !!body.deep });
  res.status(200).json({
    summary: result.summary,
    sources: result.sources,
    error: result.error || null,
  });
}
