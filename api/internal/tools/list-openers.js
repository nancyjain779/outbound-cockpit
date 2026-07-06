import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import { listOpeners } from "../../../lib/openers.js";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "list-openers");

  const track = req.query?.track || "";
  res.status(200).json(listOpeners(track));
}
