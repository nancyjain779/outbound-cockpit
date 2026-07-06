import { readBody } from "../../../lib/read-body.js";
import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import { upsertProspect } from "../../../lib/mongo.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "upsert-prospect");

  const body = await readBody(req);
  const prospect = body.prospect;
  if (!prospect?.id) { res.status(400).json({ error: "prospect.id required" }); return; }

  if (body.brief) prospect.aiBrief = body.brief;
  if (body.message) prospect.message = body.message;
  if (body.draftMessage) prospect.message = body.draftMessage;

  const result = await upsertProspect(prospect);
  if (!result.ok) {
    res.status(501).json(result);
    return;
  }
  res.status(200).json(result);
}
