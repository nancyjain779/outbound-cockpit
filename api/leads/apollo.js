/**
 * Apollo lead finder — finds founders / CTOs / innovation leads by filter.
 * Requires a MASTER APOLLO_API_KEY (regular keys return 403 API_INACCESSIBLE).
 * Create one: Apollo → Settings → Integrations → API → "Create new key" (master).
 *
 * GET /api/leads/apollo?track=A&geo=US-NRI&limit=25[&titles=Founder,CTO][&page=1]
 *
 * Uses the official People API Search endpoint:
 *   POST https://api.apollo.io/api/v1/mixed_people/api_search   (query params)
 * Docs: https://docs.apollo.io/reference/people-api-search
 *
 * NOTE: api_search is credit-free but returns OBFUSCATED previews — first name +
 * masked last name + title + company, no email/phone/LinkedIn URL. To reveal full
 * details (LinkedIn URL, email) you must enrich each person by Apollo id via the
 * People Enrichment endpoint (which consumes credits). We return the apolloId so
 * enrichment can be wired later.
 */

const APOLLO_URL = "https://api.apollo.io/api/v1/mixed_people/api_search";

// ---- Track scheme (what we decided) -----------------------------------------
// Each track filters Apollo on three axes so A/B/C/D are genuinely distinct:
//   person_titles[]                  -> job titles
//   person_seniorities[]             -> reporting level (founder/c_suite/vp/...)
//   organization_num_employees_ranges[] -> employer headcount (funded vs enterprise vs solo)
//
//   A Funded     -> founders/CTOs at small funded startups (11–200 staff)
//   B Enterprise -> innovation / digital / eng leaders at large orgs (1000+ staff)
//   C First-time -> founders/CEOs at small-but-real early teams (1–20 staff)
//   D Idea-stage -> solo founders / one-person companies (1 staff) — Apollo's
//                   closest proxy for idea-stage; pair with manual social adds
const TRACK_TITLES = {
  A: ["Founder", "Co-Founder", "CEO", "CTO"],
  B: ["Head of Innovation", "VP of Engineering", "CIO", "CTO", "Chief Digital Officer", "Director of Innovation", "Head of Digital Transformation"],
  C: ["Founder", "Co-Founder", "CEO", "Owner"],
  D: ["Founder", "Co-Founder", "Owner"],
};
const TRACK_SENIORITIES = {
  A: ["founder", "owner", "c_suite"],
  B: ["c_suite", "vp", "head", "director"],
  C: ["founder", "owner"],
  D: ["founder", "owner"],
};
// Employer headcount as Apollo "min,max" strings. C and D are kept genuinely
// distinct: C = small-but-real teams (early traction / capital), D = solo.
const TRACK_EMPLOYEES = {
  A: ["11,200"],
  B: ["1000,100000"],
  C: ["1,10", "11,20"],
  D: ["1,1"],
};

// Cockpit geo -> Apollo person_locations[] (covers every geo in the cockpit picker).
const GEO_LOCATIONS = {
  "IN-tier1": ["Bangalore, India", "Delhi, India", "Mumbai, India", "Hyderabad, India", "Pune, India"],
  "IN-tier2": ["Jaipur, India", "Indore, India", "Chandigarh, India", "Kochi, India", "Ahmedabad, India", "Coimbatore, India"],
  "IN-tier3": ["Nagpur, India", "Surat, India", "Bhopal, India", "Visakhapatnam, India", "Lucknow, India"],
  UAE: ["Dubai, United Arab Emirates", "Abu Dhabi, United Arab Emirates"],
  Saudi: ["Riyadh, Saudi Arabia", "Jeddah, Saudi Arabia"],
  SG: ["Singapore"],
  UK: ["London, United Kingdom", "Manchester, United Kingdom"],
  "US-East": ["New York, United States", "Boston, United States", "Atlanta, United States", "Miami, United States"],
  "US-NRI": ["San Francisco, United States", "New York, United States", "Austin, United States", "Seattle, United States"],
  Other: ["Canada", "Australia", "Germany", "Netherlands", "United Kingdom"],
};

const TRACK_SIGNALKEY = { A: "default", B: "innovation_role", C: "default", D: "default" };

// Title precision: founders/CEOs/CTOs should be STRICT (no "Founding Engineer"
// / "VP Sales" drift); innovation roles (B) keep similar-title expansion to
// catch variants like "Innovation Lead" / "Director, Digital".
const TRACK_SIMILAR_TITLES = { A: false, B: true, C: false, D: false };

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const key = process.env.APOLLO_API_KEY;
  if (!key?.trim()) {
    res.status(501).json({
      error: "APOLLO_API_KEY not set. Add it in Vercel → Settings → Environment Variables to enable Apollo sourcing.",
      prospects: [],
    });
    return;
  }

  let sp;
  try {
    const tail = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    sp = new URL(tail || "", "http://localhost").searchParams;
  } catch {
    sp = new URLSearchParams();
  }
  const qp = req.query || {};
  const track = (qp.track || sp.get("track") || "A").toString().toUpperCase();
  const geo = (qp.geo || sp.get("geo") || "IN-tier1").toString();
  const limit = Math.min(100, Math.max(1, parseInt(qp.limit || sp.get("limit") || "100", 10) || 100));
  const page = Math.max(1, parseInt(qp.page || sp.get("page") || "1", 10) || 1);
  const titlesRaw = (qp.titles || sp.get("titles") || "").toString();
  const titles = titlesRaw ? titlesRaw.split(",").map((t) => t.trim()).filter(Boolean) : TRACK_TITLES[track] || TRACK_TITLES.A;
  const locations = GEO_LOCATIONS[geo] || GEO_LOCATIONS["IN-tier1"];
  const seniorities = TRACK_SENIORITIES[track] || [];
  const employees = TRACK_EMPLOYEES[track] || [];
  // Optional sector focus. NOTE: Apollo's q_keywords is a literal substring
  // match on person title/headline + company name (NOT an industry filter), so
  // it narrows hard. Empty by default to preserve recall.
  const keywords = (qp.keywords || sp.get("keywords") || "").toString().trim();
  const similar = TRACK_SIMILAR_TITLES[track];

  // People API Search takes filters as QUERY parameters (arrays as key[]).
  const params = new URLSearchParams();
  titles.forEach((t) => params.append("person_titles[]", t));
  if (similar === false) params.set("include_similar_titles", "false");
  locations.forEach((l) => params.append("person_locations[]", l));
  seniorities.forEach((s) => params.append("person_seniorities[]", s));
  employees.forEach((e) => params.append("organization_num_employees_ranges[]", e));
  if (keywords) params.set("q_keywords", keywords);
  params.set("page", String(page));
  params.set("per_page", String(limit));

  try {
    const r = await fetch(APOLLO_URL + "?" + params.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": key.trim(),
      },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      let error = data?.error || data?.message || "Apollo error";
      if (data?.error_code === "API_INACCESSIBLE") {
        error = "Your Apollo key can't access People Search. This endpoint requires a MASTER API key — create one in Apollo → Settings → Integrations → API → Create new key (master).";
      }
      res.status(r.status).json({ error, prospects: [] });
      return;
    }
    const people = data?.people || [];
    const prospects = people.map((p) => ({
      name: [p.first_name, p.last_name || p.last_name_obfuscated].filter(Boolean).join(" ") || "Unknown",
      company: p.organization?.name || "",
      track,
      geo,
      platform: "LinkedIn",
      signalKey: TRACK_SIGNALKEY[track] || "default",
      profile: p.linkedin_url || "",
      signal: [p.title, p.organization?.name].filter(Boolean).join(" @ "),
      notes: p.title || "",
      apolloId: p.id || "",
      hasEmail: !!p.has_email,
      source: "apollo",
    }));
    res.status(200).json({ count: prospects.length, total: data?.total_entries || prospects.length, page, per_page: limit, prospects });
  } catch (e) {
    res.status(502).json({ error: e.message || "Apollo fetch failed", prospects: [] });
  }
}
