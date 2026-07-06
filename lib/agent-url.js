/** Normalize service URL — Render hostport omits https:// */
export function normalizeServiceUrl(raw, fallback) {
  let u = (raw || fallback).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}
