/**
 * Optional static alias registry: /b/data/aliases.json
 */
import { fetchJson } from "../shared/fetch.js";

let aliasesPromise = null;

export function loadAliases() {
  if (!aliasesPromise) {
    aliasesPromise = fetchJson("./data/aliases.json").catch(() => ({}));
  }
  return aliasesPromise;
}

export function aliasFor(aliases, ref) {
  if (!aliases || typeof aliases !== "object") return "";
  const key = String(ref || "").trim();
  const value = aliases[key] || aliases[key.toLowerCase()];
  return typeof value === "string" ? value : "";
}
