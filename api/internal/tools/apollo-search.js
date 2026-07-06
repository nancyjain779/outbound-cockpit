import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import apolloHandler from "../../leads/apollo.js";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "apollo-search");
  await apolloHandler(req, res);
}
