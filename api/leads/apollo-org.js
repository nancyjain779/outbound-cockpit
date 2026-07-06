/**
 * Apollo organization facts — company funding, size, hiring + a strong signal.
 *
 * Called at IMPORT time for every Apollo lead with a domain. Returns the full
 * `facts` (industry/size/funding/tech/keywords), hiring titles, and a signal:
 *   - `raised`     with real stage + amount (Organization Enrichment)
 *   - `hiring_eng` when the org has open engineering roles (Organization Job Postings)
 * The client stores `facts` on the prospect so AI analyse — and every later
 * re-analysis — reuses them at ZERO Apollo cost.
 *
 *   POST /api/leads/apollo-org   body: { orgs: [{ domain, id?, name? }] }   (max 10)
 *
 * Org lookups are cached (see org-lookup.js) so re-imports within the TTL don't
 * re-spend credits.
 *
 * ⚠️ CONSUMES APOLLO CREDITS (~1 per uncached org, once). Requires a MASTER API key.
 */

import { enrichOrg, orgHiringEngineers, fundingFromOrg, orgFacts } from "../leads/org-lookup.js";

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed — POST { orgs: [...] }" });
    return;
  }
  const key = process.env.APOLLO_API_KEY;
  if (!key?.trim()) {
    res.status(501).json({ error: "APOLLO_API_KEY not set.", orgs: [] });
    return;
  }
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key.trim() };

  const body = await readBody(req);
  let orgs = Array.isArray(body.orgs) ? body.orgs : [];
  orgs = orgs.filter((o) => o && (o.domain || o.id)).slice(0, 10);
  if (!orgs.length) {
    res.status(400).json({ error: "Provide orgs: [{ domain }] (1–10).", orgs: [] });
    return;
  }

  let creditsConsumed = 0;
  let authErr = null;

  const results = await Promise.all(orgs.map(async (o) => {
    // `facts`, `hiringTitles`, `allRoles` are returned so the client can STORE
    // them on the prospect — analysis later reuses them at zero Apollo cost.
    const out = { domain: o.domain || "", id: o.id || "", signalKey: null, signal: "", funding: null, hiring: false, facts: null, hiringTitles: [], allRoles: [] };
    try {
      if (o.domain) {
        const { org, credits } = await enrichOrg(o.domain, headers);
        creditsConsumed += credits;
        if (org && org.id) out.id = out.id || org.id;
        out.funding = fundingFromOrg(org);
        out.facts = orgFacts(org);
      }
      if (out.id) {
        const { hiring, titles, allTitles } = await orgHiringEngineers(out.id, headers);
        out.hiring = hiring;
        out.hiringTitles = titles || [];
        out.allRoles = allTitles || [];
      }
    } catch (e) { if (!authErr) authErr = e.message; }

    // Strongest signal wins: hiring engineers > recent funding.
    if (out.hiring) {
      out.signalKey = "hiring_eng";
      out.signal = "Hiring engineers";
    } else if (out.funding) {
      out.signalKey = "raised";
      out.signal = ["Raised", out.funding.stage, out.funding.amount].filter(Boolean).join(" \u00b7 ");
    }
    return out;
  }));

  const useful = results.filter((r) => r.signalKey);
  if (!useful.length && authErr) {
    res.status(502).json({ error: authErr, orgs: [] });
    return;
  }
  res.status(200).json({ count: useful.length, credits_consumed: creditsConsumed || null, orgs: results });
}
