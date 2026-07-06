import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import { getProspectById } from "../../../lib/mongo.js";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "get-prospect");

  const id = (req.query?.id || "").trim();
  if (!id) { res.status(400).json({ error: "id query param required" }); return; }

  const prospect = await getProspectById(id);
  res.status(200).json({ prospect: prospect || null });
}
