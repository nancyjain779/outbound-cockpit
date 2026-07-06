import { requireServiceToken, logInternalCall } from "../../../lib/internal-auth.js";
import searchHandler from "../../leads/apify-search.js";

export default async function handler(req, res) {
  if (!requireServiceToken(req, res)) return;
  logInternalCall(req, "apify-search");
  await searchHandler(req, res);
}
