import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import enrichHandler from "../../leads/apollo-enrich.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "apollo-enrich");
  await enrichHandler(req, res);
}
