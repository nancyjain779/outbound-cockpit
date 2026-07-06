/**
 * Apollo enrichment — step 2 of the lead flow.
 *
 * People API Search (apollo.js) returns obfuscated previews with an `apolloId`
 * but no LinkedIn URL / full name / email. This endpoint takes those ids and
 * reveals the real profile.
 *
 *   POST /api/leads/apollo-enrich            body: { ids: ["id1", ...] }   (max 10)
 *        /api/leads/apollo-enrich?email=1    also reveal personal emails (extra credits)
 *
 * Strategy (robust on Basic plans):
 *   1. Try Bulk People Enrichment (people/bulk_match) — 1 call for up to 10.
 *   2. For any id bulk_match didn't resolve (a known Basic-plan quirk where
 *      bulk_match returns null for search ids), fall back to single People
 *      Enrichment (people/match) per id.
 * Docs: https://docs.apollo.io/reference/bulk-people-enrichment
 *       https://docs.apollo.io/reference/people-enrichment
 *
 * ⚠️ CONSUMES APOLLO CREDITS — ~1 credit per matched person (more if emails are
 * revealed). Requires a MASTER API key, same as People Search.
 */

const BULK_URL = "https://api.apollo.io/api/v1/people/bulk_match";
const MATCH_URL = "https://api.apollo.io/api/v1/people/match";

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
  });
}

/**
 * Derive a real behavioral / firmographic signal from data the enrichment payload
 * ALREADY contains (no extra credits). Maps to an opener key that exists for the
 * given track in the cockpit's TEMPLATES, plus a human-readable trigger string.
 * Opener keys per track (must stay in sync with public/cockpit.html TEMPLATES):
 *   A: raised, ai_arch, soc2, hiring_eng, scaling, default
 *   B: intro, innovation_role, transformation, default
 *   C: cofounder, just_incorporated, accelerator, default
 *   D: cofounder, new_founder, idea_help, default
 */
function deriveSignal(m, track) {
  const org = m.organization || {};
  const fallback = [m.title, org.name].filter(Boolean).join(" @ ");
  const kw = Array.isArray(org.keywords) ? org.keywords.join(" ") : "";
  const text = [m.headline, m.title, org.name, org.industry, kw].filter(Boolean).join(" ").toLowerCase();

  const founded = parseInt(org.founded_year, 10) || 0;
  const yearsOld = founded ? new Date().getFullYear() - founded : null;
  const staff = org.estimated_num_employees || null;
  const fundStage = org.latest_funding_stage || "";
  const fundDate = org.latest_funding_round_date || "";
  const totalFunding = org.total_funding_printed || org.total_funding || "";
  let recentFunding = !!(totalFunding || fundStage);
  if (!recentFunding && fundDate) {
    const months = (Date.now() - new Date(fundDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
    recentFunding = months >= 0 && months <= 18;
  }
  const aiCo = /\b(ai|a\.i\.|ml|machine learning|llm|gen ?ai|generative|deep learning|nlp|computer vision)\b/.test(text);
  const regulated = /\b(soc ?2|iso ?27001|compliance|fintech|health ?tech|healthcare|insurance|banking|payments|cybersecurity|security|hipaa|gdpr)\b/.test(text);

  const T = (track || "A").toUpperCase();
  const staffBit = staff ? staff + " staff" : "";
  const pack = (key, label) => ({
    signalKey: key,
    signal: label ? [label, org.name, staffBit].filter(Boolean).join(" \u00b7 ") : fallback,
  });

  if (T === "A") {
    if (recentFunding) {
      const bits = ["Raised", fundStage, totalFunding].filter(Boolean).join(" \u00b7 ");
      return pack("raised", bits);
    }
    if (aiCo) return pack("ai_arch", "AI/ML company");
    if (regulated) return pack("soc2", "Enterprise/regulated");
    return pack("default", "");
  }
  if (T === "B") {
    if (/transformation|digital/.test(text)) return pack("transformation", "Digital transformation");
    return pack("innovation_role", "Innovation mandate");
  }
  if (T === "C") {
    if (yearsOld != null && yearsOld <= 2) return pack("just_incorporated", "New company" + (founded ? " \u00b7 " + founded : ""));
    return pack("default", "");
  }
  if (T === "D") {
    if (yearsOld != null && yearsOld <= 2) return pack("new_founder", "Early-stage" + (founded ? " \u00b7 " + founded : ""));
    return pack("default", "");
  }
  return pack("default", "");
}

function mapPerson(m, track) {
  if (!m) return null;
  const org = m.organization || {};
  const job = (m.employment_history || []).find((e) => e.current) || {};
  const sig = deriveSignal(m, track);
  return {
    apolloId: m.id || "",
    name: m.name || [m.first_name, m.last_name].filter(Boolean).join(" ") || "Unknown",
    company: org.name || job.organization_name || "",
    domain: org.primary_domain || (org.website_url || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "",
    orgId: org.id || "",
    profile: m.linkedin_url || "",
    twitter: m.twitter_url || "",
    platform: m.linkedin_url ? "LinkedIn" : m.twitter_url ? "Twitter" : "LinkedIn",
    email: m.email || "",
    emailStatus: m.email_status || "",
    photo: m.photo_url || "",
    signalKey: sig.signalKey,
    signal: sig.signal,
    notes: m.headline || m.title || "",
    city: m.city || "",
    state: m.state || "",
    country: m.country || "",
    source: "apollo",
  };
}

function authError(data) {
  if (data?.error_code === "API_INACCESSIBLE") {
    return "Enrichment needs a MASTER Apollo API key (Settings → API Keys → create a master key).";
  }
  return data?.error || data?.message || "Apollo enrichment error";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed — POST { ids: [...] }" });
    return;
  }
  const key = process.env.APOLLO_API_KEY;
  if (!key?.trim()) {
    res.status(501).json({ error: "APOLLO_API_KEY not set.", prospects: [] });
    return;
  }
  const apiKey = key.trim();
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apiKey };

  const body = await readBody(req);
  let details = Array.isArray(body.details) ? body.details : [];
  if (!details.length && Array.isArray(body.ids)) details = body.ids.map((id) => ({ id }));
  details = details.filter((d) => d && (d.id || d.linkedin_url || d.email || d.name)).slice(0, 10);
  if (!details.length) {
    res.status(400).json({ error: "Provide ids: [...] (1–10 Apollo person ids)", prospects: [] });
    return;
  }

  // Track travels with each detail so deriveSignal can target the right opener set.
  const trackById = {};
  details.forEach((d) => { if (d.id) trackById[d.id] = (d.track || "A").toUpperCase(); });

  const revealEmail = ["1", "true", "yes"].includes(String((req.query && req.query.email) || "").toLowerCase());
  const emailQS = revealEmail ? "?reveal_personal_emails=true" : "";

  const byId = {};           // apolloId -> mapped prospect
  let creditsConsumed = 0;
  let authErr = null;

  // --- 1) bulk fast-path -----------------------------------------------------
  try {
    const r = await fetch(BULK_URL + emailQS, { method: "POST", headers, body: JSON.stringify({ details }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      authErr = authError(data);
    } else {
      creditsConsumed += data?.credits_consumed || 0;
      (data?.matches || []).forEach((m) => {
        const p = mapPerson(m, trackById[m.id]);
        if (p && p.profile) byId[p.apolloId || m.id] = p; // only keep usable (has LinkedIn) matches
      });
    }
  } catch (e) {
    authErr = e.message || "bulk_match failed";
  }

  // --- 2) per-id fallback for anything bulk didn't resolve -------------------
  const unresolved = details.filter((d) => d.id && !byId[d.id]);
  if (unresolved.length) {
    await Promise.all(unresolved.map(async (d) => {
      try {
        const qs = new URLSearchParams({ id: d.id });
        if (revealEmail) qs.set("reveal_personal_emails", "true");
        const r = await fetch(MATCH_URL + "?" + qs.toString(), { method: "POST", headers });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { if (!authErr) authErr = authError(data); return; }
        creditsConsumed += data?.credits_consumed || 0;
        const p = mapPerson(data?.person, trackById[d.id] || d.track);
        if (p) byId[d.id] = p;
      } catch (e) { if (!authErr) authErr = e.message; }
    }));
  }

  const prospects = Object.values(byId).filter((p) => p && p.profile);
  if (!prospects.length && authErr) {
    res.status(502).json({ error: authErr, prospects: [] });
    return;
  }
  res.status(200).json({
    count: prospects.length,
    credits_consumed: creditsConsumed || null,
    missing: details.length - prospects.length,
    prospects,
  });
}
