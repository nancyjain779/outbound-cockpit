import { readBody } from "../../../lib/read-body.js";
import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import { scrapeLinkedInProfile } from "../../leads/apify.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "linkedin-profile");

  if (!process.env.APIFY_TOKEN?.trim()) {
    res.status(501).json({ error: "APIFY_TOKEN not set" });
    return;
  }

  const body = await readBody(req);
  const profileUrl = (body.profileUrl || body.url || "").trim();
  if (!profileUrl) { res.status(400).json({ error: "profileUrl required" }); return; }

  const skipProfile = !!body.skipProfile;
  const profile = await scrapeLinkedInProfile(profileUrl, { skipProfile });
  if (!profile) {
    res.status(200).json({ profile: null, headline: "", about: "", recentPosts: [] });
    return;
  }
  res.status(200).json({
    profile,
    headline: profile.headline || "",
    about: profile.about || "",
    recentPosts: profile.recentPosts || [],
    text: profile.text || "",
    postCount: profile.postCount || 0,
  });
}
