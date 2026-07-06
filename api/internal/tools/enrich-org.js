import { readBody } from "../../../lib/read-body.js";
import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import { enrichOrg, orgHiringEngineers, orgFacts } from "../../../lib/org-lookup.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "enrich-org");

  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) { res.status(501).json({ error: "APOLLO_API_KEY not set" }); return; }

  const body = await readBody(req);
  const domain = (body.domain || "").trim();
  const orgId = body.orgId || body.id || "";
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key };

  let credits = 0;
  let facts = null;
  let hiringTitles = [];
  let allRoles = [];
  let resolvedOrgId = orgId;

  try {
    if (domain) {
      const { org, credits: c } = await enrichOrg(domain, headers);
      credits += c;
      facts = orgFacts(org);
      if (org?.id) resolvedOrgId = org.id;
    }
    if (resolvedOrgId) {
      const { titles, allTitles } = await orgHiringEngineers(resolvedOrgId, headers);
      hiringTitles = titles || [];
      allRoles = allTitles || [];
    }
  } catch (e) {
    res.status(502).json({ error: e.message || "enrich failed" });
    return;
  }

  res.status(200).json({ facts, hiringTitles, allRoles, orgId: resolvedOrgId, credits_consumed: credits || null });
}
