/**
 * Resolves a public business reference:
 *   npub1… | 64-char hex | name@domain | static alias
 */
import { isHex64, npubToHex } from "../shared/bech32.js";
import { aliasFor, loadAliases } from "../data/aliases.js";
import { resolveNip05 } from "./nip05.js";

export function cleanRef(raw) {
  let value = String(raw || "").trim();
  if (!value) return "";
  if (/^nostr:/i.test(value)) value = value.slice(6).trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const match = url.pathname.match(/\/b\/([^/]+)\/?$/);
      if (match) {
        value = decodeURIComponent(match[1]);
      } else {
        const parts = url.pathname.split("/").filter(Boolean);
        value = parts.length
          ? decodeURIComponent(parts[parts.length - 1])
          : "";
      }
    } catch {
      /* keep the raw value */
    }
  }
  if (value.startsWith("@")) value = value.slice(1);
  return value.trim();
}

export function refFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  const index = parts.lastIndexOf("b");
  if (index === -1) return "";
  const next = parts[index + 1];
  if (!next || next === "index.html") return "";
  if (index + 2 < parts.length) return "";
  try {
    return decodeURIComponent(next);
  } catch {
    return next;
  }
}

export async function resolveRef(raw, seen = new Set()) {
  const value = cleanRef(raw);
  if (!value) throw new Error("Enter an npub, NIP-05 address, or alias.");
  if (seen.has(value)) throw new Error("That alias points back to itself.");
  seen.add(value);

  if (value.toLowerCase().startsWith("npub1")) {
    return { pubkey: npubToHex(value), ref: value, nip05: "", alias: "" };
  }
  if (isHex64(value)) {
    return { pubkey: value.toLowerCase(), ref: value.toLowerCase(), nip05: "", alias: "" };
  }
  if (value.includes("@")) {
    const pubkey = await resolveNip05(value);
    return { pubkey, ref: value, nip05: value, alias: "" };
  }

  const aliases = await loadAliases();
  const target = aliasFor(aliases, value);
  if (!target) {
    throw new Error(
      `No profile alias "${value}" is registered here. Use an npub or a NIP-05 address instead.`
    );
  }
  const resolved = await resolveRef(target, seen);
  return { ...resolved, ref: value, alias: value };
}
