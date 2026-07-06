/** Shared MongoDB access for cockpit prospects and agent threads. */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "";
const dbName = process.env.MONGODB_DB || "outbound_cockpit";
const PROSPECTS_COL = process.env.MONGODB_COCKPIT_COLLECTION || "outreach_prospects";
const THREADS_COL = process.env.MONGODB_THREADS_COLLECTION || "agent_threads";

let clientPromise = null;

export function mongoEnabled() {
  return Boolean(uri && dbName);
}

async function db() {
  if (!mongoEnabled()) return null;
  if (!clientPromise) {
    clientPromise = new MongoClient(uri, { maxPoolSize: 10, minPoolSize: 0 }).connect();
  }
  const client = await clientPromise;
  return client.db(dbName);
}

export async function prospectsCollection() {
  const database = await db();
  return database ? database.collection(PROSPECTS_COL) : null;
}

export async function threadsCollection() {
  const database = await db();
  return database ? database.collection(THREADS_COL) : null;
}

export async function getProspectById(id) {
  const c = await prospectsCollection();
  if (!c || !id) return null;
  return c.findOne({ id }, { projection: { _id: 0 } });
}

export async function upsertProspect(prospect) {
  const c = await prospectsCollection();
  if (!c || !prospect?.id) return { ok: false, error: "Mongo not configured or missing prospect.id" };
  await c.replaceOne({ id: prospect.id }, prospect, { upsert: true });
  return { ok: true, id: prospect.id };
}
