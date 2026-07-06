import { readBody } from "../../../lib/read-body.js";
import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import { fetchSiteText } from "../../../lib/org-lookup.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "scrape-site");

  const body = await readBody(req);
  const url = (body.url || "").trim();
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  const text = await fetchSiteText(url);
  res.status(200).json({ text, chars: text.length });
}
