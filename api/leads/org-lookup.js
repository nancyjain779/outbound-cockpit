/**
 * Shared Apollo organization lookup with an in-process TTL cache.
 *
 * Used by:
 *   - api/leads/apollo-org.js   (Track A funding + hiring boost on import)
 *   - api/ai/analyse.js         (deep prospect intelligence — company facts)
 *
 * Caching means re-importing or re-analysing the same company within the TTL
 * does NOT spend extra Apollo credits. Cache is per-process (resets on deploy).
 *
 * Docs: https://docs.apollo.io/reference/organization-enrichment
 *       https://docs.apollo.io/reference/organization-jobs-postings
 */

const ENRICH_URL = "https://api.apollo.io/api/v1/organizations/enrich";
const JOBS_URL = (id) => `https://api.apollo.io/api/v1/organizations/${id}/job_postings`;
const TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const ENG_RE = /\b(engineer|engineering|developer|software|backend|front ?end|full ?stack|sre|devops|machine learning|ml engineer|platform)\b/i;

const orgCache = new Map();   // domain -> { t, org }
const jobsCache = new Map();  // orgId  -> { t, hiring, titles }

function getCache(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (Date.now() - v.t > TTL_MS) { map.delete(key); return null; }
  return v;
}

/** Recent funding (or null) distilled from an Apollo organization object. */
export function fundingFromOrg(org) {
  if (!org) return null;
  const stage = org.latest_funding_stage || "";
  const amount = org.total_funding_printed || (org.total_funding ? String(org.total_funding) : "");
  const date = org.latest_funding_round_date || "";
  if (!stage && !amount && !date) return null;
  let recent = !!(stage || amount);
  if (!recent && date) {
    const months = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24 * 30);
    recent = months >= 0 && months <= 24;
  }
  return recent ? { stage, amount, date } : null;
}

/**
 * Enrich a single org by domain. Returns { org, credits, cached }.
 * org is the raw Apollo organization object (or null). Throws on auth/HTTP error.
 */
export async function enrichOrg(domain, headers) {
  if (!domain) return { org: null, credits: 0, cached: false };
  const hit = getCache(orgCache, domain);
  if (hit) return { org: hit.org, credits: 0, cached: true };

  const qs = new URLSearchParams({ domain });
  const r = await fetch(ENRICH_URL + "?" + qs.toString(), { method: "POST", headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data?.error || data?.message || "Org enrich error " + r.status);
    err.code = data?.error_code;
    throw err;
  }
  const org = data?.organization || data?.org || null;
  orgCache.set(domain, { t: Date.now(), org });
  return { org, credits: data?.credits_consumed || 0, cached: false };
}

/**
 * Org job postings. Returns { hiring, titles, allTitles }:
 *   - hiring    = has at least one open ENGINEERING role
 *   - titles    = up to 5 engineering titles
 *   - allTitles = up to 12 of all open roles (signals what the company is scaling)
 * Cached by org id. Never throws.
 */
export async function orgHiringEngineers(orgId, headers) {
  if (!orgId) return { hiring: false, titles: [], allTitles: [] };
  const hit = getCache(jobsCache, orgId);
  if (hit) return { hiring: hit.hiring, titles: hit.titles, allTitles: hit.allTitles };
  try {
    const r = await fetch(JOBS_URL(orgId), { method: "GET", headers });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { hiring: false, titles: [], allTitles: [] };
    const postings = d?.organization_job_postings || d?.job_postings || [];
    const all = postings.map((j) => j.title || "").filter(Boolean);
    const engTitles = all.filter((t) => ENG_RE.test(t));
    const out = { hiring: engTitles.length > 0, titles: engTitles.slice(0, 5), allTitles: all.slice(0, 12) };
    jobsCache.set(orgId, { t: Date.now(), hiring: out.hiring, titles: out.titles, allTitles: out.allTitles });
    return out;
  } catch {
    return { hiring: false, titles: [], allTitles: [] };
  }
}

/**
 * Best-effort fetch of a company's website text (homepage). No auth, no credits.
 * Strips scripts/styles/markup and returns ~4k chars. Times out fast so a slow
 * site never blocks the analysis. Returns "" on any failure.
 */
export async function fetchSiteText(url) {
  if (!url) return "";
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(u, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OutboundCockpit/1.0)", Accept: "text/html" },
    });
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "";
    if (!/text\/html|text\/plain/i.test(ct)) return "";
    let html = await r.text();
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return html.slice(0, 4000);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Flatten an Apollo org into the compact facts the AI prompt / UI care about. */
export function orgFacts(org) {
  if (!org) return null;
  const f = fundingFromOrg(org);
  return {
    name: org.name || "",
    industry: org.industry || "",
    description: (org.short_description || org.seo_description || "").slice(0, 600),
    foundedYear: org.founded_year || null,
    employees: org.estimated_num_employees || null,
    website: org.website_url || (org.primary_domain ? "https://" + org.primary_domain : ""),
    technologies: Array.isArray(org.technology_names) ? org.technology_names.slice(0, 12) : [],
    keywords: Array.isArray(org.keywords) ? org.keywords.slice(0, 12) : [],
    funding: f,
  };
}
