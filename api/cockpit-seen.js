/**
 * Synced de-dup ledger — the set of lead keys you've already imported/sent, so
 * the same person never resurfaces on a second device.
 *
 *   GET /api/cockpit-seen           -> { keys: ["<key>", ...] }
 *   PUT /api/cockpit-seen           -> body { keys: [...] }   (UNION-merged, never shrinks)
 *
 * Keys are opaque strings (a profile URL, or "name|platform") so they're stored
 * as an array, not as object fields (URLs contain dots that Mongo disallows).
 * Falls back to 501 when Mongo isn't configured (cockpit then stays local-only).
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "";
const dbName = process.env.MONGODB_DB || "outbound_cockpit";
const COLLECTION = process.env.MONGODB_SEEN_COLLECTION || "outreach_seen";
const TOKEN = process.env.COCKPIT_TOKEN || "";
const DOC_ID = "seen";

let clientPromise = null;
function enabled() { return Boolean(uri && dbName); }
async function coll() {
  if (!enabled()) return null;
  if (!clientPromise) clientPromise = new MongoClient(uri, { maxPoolSize: 10, minPoolSize: 0 }).connect();
  const client = await clientPromise;
  return client.db(dbName).collection(COLLECTION);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (TOKEN && req.headers["x-cockpit-token"] !== TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const c = await coll();
  if (!c) {
    res.status(501).json({ error: "Cloud store not configured.", keys: [] });
    return;
  }
  try {
    if (req.method === "GET") {
      const doc = await c.findOne({ id: DOC_ID }, { projection: { _id: 0, keys: 1 } });
      res.status(200).json({ keys: (doc && doc.keys) || [] });
      return;
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      const incoming = Array.isArray(body.keys) ? body.keys.map(String).filter(Boolean) : [];
      if (incoming.length) {
        await c.updateOne(
          { id: DOC_ID },
          { $addToSet: { keys: { $each: incoming } } },
          { upsert: true }
        );
      }
      const doc = await c.findOne({ id: DOC_ID }, { projection: { _id: 0, keys: 1 } });
      res.status(200).json({ ok: true, count: (doc && doc.keys && doc.keys.length) || 0 });
      return;
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Seen-store error" });
  }
}
