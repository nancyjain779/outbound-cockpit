/**
 * Cockpit cloud store — syncs prospects across devices (desktop + phone).
 * Backed by MongoDB (reuses your existing MONGODB_URI setup).
 *
 *   GET    /api/cockpit            -> { prospects: [...] }
 *   PUT    /api/cockpit            -> body { prospects: [...] }  (full replace/upsert)
 *   DELETE /api/cockpit?id=ID      -> remove one
 *
 * Optional shared-secret: set COCKPIT_TOKEN in Vercel env. When set, requests
 * must send header `x-cockpit-token`. If Mongo isn't configured the endpoint
 * returns 501 and the cockpit falls back to browser localStorage automatically.
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "";
const dbName = process.env.MONGODB_DB || "outbound_cockpit";
const COLLECTION = process.env.MONGODB_COCKPIT_COLLECTION || "outreach_prospects";
const TOKEN = process.env.COCKPIT_TOKEN || "";

let clientPromise = null;
function enabled() {
  return Boolean(uri && dbName);
}
async function coll() {
  if (!enabled()) return null;
  if (!clientPromise) {
    clientPromise = new MongoClient(uri, { maxPoolSize: 10, minPoolSize: 0 }).connect();
  }
  const client = await clientPromise;
  return client.db(dbName).collection(COLLECTION);
}

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

export default async function handler(req, res) {
  if (TOKEN && req.headers["x-cockpit-token"] !== TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const c = await coll();
  if (!c) {
    res.status(501).json({ error: "Cloud store not configured (MONGODB_URI missing). Using local storage.", prospects: [] });
    return;
  }
  try {
    if (req.method === "GET") {
      const prospects = await c.find({}, { projection: { _id: 0 } }).toArray();
      res.status(200).json({ prospects });
      return;
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      const list = Array.isArray(body.prospects) ? body.prospects : [];
      const ops = list.map((p) => ({
        replaceOne: { filter: { id: p.id }, replacement: p, upsert: true },
      }));
      if (ops.length) await c.bulkWrite(ops);
      // remove any deleted-on-client docs not present in the payload
      const ids = list.map((p) => p.id);
      await c.deleteMany({ id: { $nin: ids } });
      res.status(200).json({ ok: true, count: list.length });
      return;
    }
    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || new URL(req.url, "http://localhost").searchParams.get("id");
      if (id) await c.deleteOne({ id });
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ error: e.message || "Store error" });
  }
}
