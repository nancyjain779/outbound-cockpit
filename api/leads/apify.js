/**
 * Apify-powered gated LinkedIn enrichment (profile details + recent posts).
 *
 * Fills what Perplexity/Google can't reliably read: the prospect's LinkedIn
 * profile (headline, About, experience) AND their latest posts — the highest-
 * signal input for consultative, problem-first outreach.
 *
 * Runs TWO actors on demand (merged into one brief):
 *   1. Profile details — apimaestro/linkedin-profile-detail (default)
 *   2. Recent posts    — harvestapi/linkedin-profile-posts (default)
 *
 * Env (all optional except APIFY_TOKEN):
 *   APIFY_TOKEN
 *   APIFY_LINKEDIN_PROFILE_ACTOR       default: apimaestro~linkedin-profile-detail
 *   APIFY_LINKEDIN_POSTS_ACTOR         default: harvestapi~linkedin-profile-posts
 *
 * IMPORTANT: only PUBLIC-profile actors (proxy-based). Never li_at cookie actors.
 * Caching is per-process (12h TTL). Never throws.
 */

const TTL_MS = 1000 * 60 * 60 * 12;
const profileCache = new Map(); // url -> { t, profile }
const postsCache = new Map();   // url -> { t, posts }

function getCache(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (Date.now() - v.t > TTL_MS) { map.delete(key); return null; }
  return v;
}

export function isLinkedInProfile(url) {
  return typeof url === "string" && /linkedin\.com\/in\//i.test(url);
}

// Clean a LinkedIn profile URL for the actors: force https, drop query/hash and
// trailing slash, normalise the host. Keeps the /in/<slug> path intact.
function normalizeProfileUrl(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  u = u.replace(/^http:\/\//i, "https://");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  u = u.split(/[?#]/)[0].replace(/\/+$/, "");
  u = u.replace(/^https:\/\/[a-z]{2,3}\.linkedin\.com/i, "https://www.linkedin.com");
  return u;
}

function normalizeActorId(actorId) {
  return String(actorId || "").trim().replace(/\//g, "~");
}

async function runActor(actorId, input) {
  const token = process.env.APIFY_TOKEN?.trim();
  const id = normalizeActorId(actorId);
  if (!token || !id) return [];
  const url =
    "https://api.apify.com/v2/acts/" + encodeURIComponent(id) +
    "/run-sync-get-dataset-items?token=" + encodeURIComponent(token);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input || {}),
    });
    if (!r.ok) {
      if (process.env.COCKPIT_DEV) {
        const err = await r.text().catch(() => "");
        console.warn("[apify] " + id + " failed " + r.status + (err ? ": " + err.slice(0, 200) : ""));
      }
      return [];
    }
    const items = await r.json().catch(() => []);
    return Array.isArray(items) ? items : [];
  } catch (e) {
    if (process.env.COCKPIT_DEV) console.warn("[apify] " + id + " error:", e?.message || e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function first(...vals) {
  for (const v of vals) if (v != null && String(v).trim() !== "") return v;
  return "";
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function clip(s, n) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "\u2026" : t;
}

// A post date can be a plain string OR an object (e.g. harvestapi's
// { timestamp, date, postedAgoShort, postedAgoText }). Return a short label.
function dateStr(v) {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    const s = first(v.postedAgoShort, v.postedAgoText, v.date, v.timestamp ? new Date(v.timestamp).toISOString() : "");
    const str = String(s || "").trim();
    return /^\d{4}-\d{2}-\d{2}T/.test(str) ? str.slice(0, 10) : str.replace(/\s*•.*$/, "").trim();
  }
  return "";
}

function locStr(v) {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") return first(v.full, v.city, [v.city, v.country].filter(Boolean).join(", "));
  return "";
}

function mapProfileItem(item) {
  if (!item || typeof item !== "object") return null;
  // apimaestro nests under basic_info / experience; other actors are flat.
  const b = item.basic_info && typeof item.basic_info === "object" ? item.basic_info : item;

  const name = first(b.fullname, b.fullName, [b.first_name || b.firstName, b.last_name || b.lastName].filter(Boolean).join(" "), b.name);
  const headline = first(b.headline, b.occupation, b.subtitle, b.jobTitle);
  const about = clip(first(b.about, b.summary, b.bio), 1500);
  const location = locStr(first(b.location, b.addressWithCountry, b.geoLocationName, b.addressWithoutCountry));
  const email = first(item.email, b.email, item.personalEmail, item.workEmail);

  const positions = arr(item.experience).length ? arr(item.experience)
    : arr(item.experiences).length ? arr(item.experiences) : arr(item.positions);
  const experiences = positions
    .map((e) => {
      const title = first(e.title, e.role, e.position);
      const company = first(e.company, e.companyName, e.subtitle);
      return [title, company].filter(Boolean).join(" at ");
    })
    .filter(Boolean)
    .slice(0, 5);

  const current = positions.find((e) => e && (e.is_current || e.isCurrent)) || positions[0];
  const currentRole = first(b.jobTitle, current && (current.title || current.role));
  const company = first(b.companyName, current && (current.company || current.companyName));

  const skills = arr(item.skills)
    .map((s) => (typeof s === "string" ? s : first(s.name, s.title)))
    .filter(Boolean)
    .slice(0, 12);

  if (!name && !headline && !about && !experiences.length) return null;
  return { name, headline, about, location, email, currentRole, company, experiences, skills, recentPosts: [] };
}

// Posts actor often returns one row per post (not nested under profile).
function mapPostsItems(items) {
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    // Nested posts array on a wrapper row
    const nested = arr(item.posts).length ? arr(item.posts) : arr(item.updates);
    if (nested.length) {
      for (const p of nested) {
        const text = clip(first(typeof p === "string" ? p : "", p.text, p.content, p.postText, p.commentary, p.title), 500);
        if (!text) continue;
        out.push({ text, date: dateStr(first(p.postedAt, p.date, p.time, p.publishedAt)) });
      }
      continue;
    }
    const text = clip(first(item.content, item.text, item.postText, item.commentary, item.title, item.postContent), 500);
    if (!text) continue;
    out.push({ text, date: dateStr(first(item.postedAt, item.date, item.time, item.publishedAt, item.createdAt)) });
  }
  return out.slice(0, 5);
}

function mergePosts(profile, posts) {
  if (!profile) return null;
  profile.recentPosts = (posts || []).map((p) => {
    const bit = p.date ? "[" + p.date + "] " + p.text : p.text;
    return bit;
  });
  return profile;
}

export function profileToText(p, opts) {
  if (!p) return "";
  const postsOnly = !!(opts && opts.postsOnly);
  const lines = [];
  lines.push(postsOnly
    ? "VERIFIED LinkedIn posts (Apify scrape — highest signal for what they care about right now; company/person context already from Apollo + website above):"
    : "VERIFIED LinkedIn data (Apify scrape — highest trust, use for message + conversation context):");
  if (!postsOnly) {
    if (p.name) lines.push("- Name: " + p.name);
    if (p.headline) lines.push("- Headline: " + p.headline);
    if (p.currentRole || p.company) lines.push("- Current: " + [p.currentRole, p.company].filter(Boolean).join(" at "));
    if (p.location) lines.push("- Location: " + p.location);
    if (p.about) lines.push("- About: " + p.about);
    if (p.experiences && p.experiences.length) lines.push("- Experience: " + p.experiences.join("; "));
    if (p.skills && p.skills.length) lines.push("- Skills: " + p.skills.join(", "));
  }
  if (p.recentPosts && p.recentPosts.length) {
    lines.push("- Recent LinkedIn posts (PRIORITY — what they care about right now):");
    p.recentPosts.forEach((post) => lines.push("  • " + post));
  } else if (!postsOnly) {
    lines.push("- Recent posts: (none returned by scrape)");
  }
  return lines.join("\n");
}

async function scrapeProfileDetails(url) {
  const hit = getCache(profileCache, url);
  if (hit) return hit.profile;
  const actorId = process.env.APIFY_LINKEDIN_PROFILE_ACTOR?.trim() || "apimaestro~linkedin-profile-detail";
  // apimaestro/linkedin-profile-detail accepts username slug or full profile URL
  const items = await runActor(actorId, { username: url, includeEmail: false });
  const profile = mapProfileItem(items[0]);
  if (profile) profileCache.set(url, { t: Date.now(), profile });
  return profile;
}

async function scrapeProfilePosts(url) {
  const hit = getCache(postsCache, url);
  if (hit) return hit.posts;
  const actorId = process.env.APIFY_LINKEDIN_POSTS_ACTOR?.trim() || "harvestapi~linkedin-profile-posts";
  const items = await runActor(actorId, {
    targetUrls: [url],
    maxPosts: 5,
    postedLimit: "month",
    includeQuotePosts: true,
    includeReposts: false,
  });
  const posts = mapPostsItems(items);
  if (posts.length) postsCache.set(url, { t: Date.now(), posts });
  return posts;
}

/**
 * Scrape LinkedIn enrichment. When skipProfile=true, only runs the posts actor
 * (cheaper — use when Apollo + website already cover company/person context).
 */
export async function scrapeLinkedInProfile(rawUrl, opts) {
  if (!isLinkedInProfile(rawUrl) || !process.env.APIFY_TOKEN?.trim()) return null;
  const url = normalizeProfileUrl(rawUrl);
  const skipProfile = !!(opts && opts.skipProfile);
  let profile = null;
  let posts = [];
  if (skipProfile) {
    posts = await scrapeProfilePosts(url);
  } else {
    [profile, posts] = await Promise.all([scrapeProfileDetails(url), scrapeProfilePosts(url)]);
  }

  const merged = mergePosts(profile || { recentPosts: [] }, posts);
  if (!merged || (!merged.name && !merged.headline && !merged.about && !merged.recentPosts.length)) return null;
  merged.text = profileToText(merged, { postsOnly: skipProfile });
  merged.postCount = merged.recentPosts.length;
  merged.skippedProfile = skipProfile;
  return merged;
}

// --- Intent sourcing: find people POSTING about a topic -----------------------
// Apollo can only see firmographics; it can't see who is actively asking for
// dev help RIGHT NOW. This searches LinkedIn posts by keyword and turns the
// post AUTHORS into leads, carrying the triggering post as the "why now" signal.

// Build a clean /in/<slug> URL from the actor's publicIdentifier (its raw
// linkedinUrl carries tracking params and sometimes the opaque ACoAA… id).
function cleanInUrl(publicId, fallback) {
  const pid = String(publicId || "").trim();
  if (pid && /^[A-Za-z0-9\-_%]+$/.test(pid)) return "https://www.linkedin.com/in/" + pid;
  return normalizeProfileUrl(fallback || "");
}

// Pull a company name out of a headline like "Founder @ Acme | …" or
// "UX Leadership at Amazon | …". Best-effort only.
function companyFromInfo(info) {
  const head = String(info || "").split("|")[0];
  const m = head.match(/\b(?:at|@)\s+(.+)$/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

/**
 * Search LinkedIn posts by keyword(s) and return de-duplicated post AUTHORS as
 * lead candidates. queries: array or newline/comma string (each clipped to 85
 * chars, LinkedIn's search limit). Never throws; returns [] when off/empty.
 */
export async function searchLinkedInPosts(queries, opts) {
  if (!process.env.APIFY_TOKEN?.trim()) return [];
  const list = (Array.isArray(queries) ? queries : String(queries || "").split(/\r?\n|,/))
    .map((s) => String(s || "").trim().slice(0, 85))
    .filter(Boolean)
    .slice(0, 12);
  if (!list.length) return [];

  const actorId = process.env.APIFY_LINKEDIN_POST_SEARCH_ACTOR?.trim() || "harvestapi~linkedin-post-search";
  const maxPosts = Math.min(50, Math.max(1, parseInt((opts && opts.maxPosts) || 15, 10) || 15));
  const postedLimit = (opts && opts.postedLimit) || "month";
  // Relevance (not date) dramatically improves precision: LinkedIn ranks by how
  // well the post matches the query instead of returning the newest token hits.
  const sortBy = (opts && opts.sortBy) || "relevance";

  const items = await runActor(actorId, { searchQueries: list, maxPosts, postedLimit, sortBy });

  // One lead per author; first match wins (results arrive newest-first).
  const byAuthor = new Map();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const a = it.author && typeof it.author === "object" ? it.author : {};
    if (a.type && a.type !== "profile") continue; // skip company-page authors
    const pid = String(a.publicIdentifier || "").trim();
    const profile = cleanInUrl(pid, a.linkedinUrl);
    if (!isLinkedInProfile(profile)) continue;
    const postText = clip(first(it.content, it.text, it.commentary), 600);
    if (!postText) continue;
    const key = pid || profile.toLowerCase();
    if (byAuthor.has(key)) continue;
    byAuthor.set(key, {
      name: first(a.name, pid) || "Unknown",
      headline: first(a.info, a.occupation, ""),
      company: companyFromInfo(first(a.info, a.occupation)),
      profile,
      postText,
      postUrl: first(it.linkedinUrl, it.shareUrl, it.socialContent && it.socialContent.shareUrl),
      postedAt: dateStr(it.postedAt),
    });
  }
  return Array.from(byAuthor.values());
}
