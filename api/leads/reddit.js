/**
 * Reddit lead finder — search subreddits for founder/intent posts.
 * GET /api/leads/reddit?q=looking+for+developer&subreddit=startups&limit=25
 */
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

let tokenCache = { token: "", expires: 0 };

async function getRedditToken() {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  const userAgent = process.env.REDDIT_USER_AGENT?.trim() || "web:outbound-cockpit:v1";
  if (!clientId || !clientSecret) return null;
  if (tokenCache.token && Date.now() < tokenCache.expires) return { token: tokenCache.token, userAgent };

  const auth = Buffer.from(clientId + ":" + clientSecret).toString("base64");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: "grant_type=client_credentials",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) return null;
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 - 60000 };
  return { token: tokenCache.token, userAgent };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = await getRedditToken();
  if (!auth) {
    res.status(501).json({
      error: "Reddit OAuth not configured. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT.",
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
  const q = (qp.q || sp.get("q") || "looking for developer").toString();
  const subreddit = (qp.subreddit || sp.get("subreddit") || "startups").toString();
  const limit = Math.min(50, Math.max(1, parseInt(qp.limit || sp.get("limit") || "25", 10) || 25));
  const track = (qp.track || sp.get("track") || "D").toString().toUpperCase();
  const geo = (qp.geo || sp.get("geo") || "").toString();

  const searchUrl = "https://oauth.reddit.com/r/" + encodeURIComponent(subreddit) + "/search.json?q=" +
    encodeURIComponent(q) + "&restrict_sr=1&sort=new&limit=" + limit;

  try {
    const r = await fetch(searchUrl, {
      headers: { Authorization: "Bearer " + auth.token, "User-Agent": auth.userAgent },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(r.status).json({ error: data?.message || "Reddit search failed", prospects: [] });
      return;
    }
    const posts = data?.data?.children || [];
    const prospects = posts.map((c) => {
      const p = c.data || {};
      const author = p.author || "unknown";
      return {
        name: "u/" + author,
        company: "",
        track,
        geo,
        platform: "Reddit",
        signalKey: "idea_help",
        profile: "https://reddit.com/u/" + author,
        signal: (p.title || "") + (p.selftext ? " — " + p.selftext.slice(0, 120) : ""),
        notes: p.title || "",
        postUrl: "https://reddit.com" + (p.permalink || ""),
        source: "reddit",
      };
    });
    res.status(200).json({ count: prospects.length, prospects });
  } catch (e) {
    res.status(502).json({ error: e.message || "Reddit fetch failed", prospects: [] });
  }
}
