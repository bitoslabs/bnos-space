/**
 * NIP-05 resolution and the owner setup helper.
 */
import { fetchJson } from "../shared/fetch.js";
import { isNip05 } from "../shared/urls.js";
import { isHex64 } from "../shared/bech32.js";

export async function resolveNip05(identifier) {
  const match = String(identifier || "")
    .trim()
    .match(/^([^@\s/#?]+)@([^@\s/#?]+)$/);
  if (!match) throw new Error("NIP-05 must look like name@domain.com");
  const [, name, domain] = match;
  const endpoint = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(
    name
  )}`;

  let data;
  try {
    data = await fetchJson(endpoint);
  } catch {
    throw new Error(
      `Could not verify ${identifier}. The domain may be offline or may not allow browser requests.`
    );
  }

  const names = data && data.names;
  if (!names || typeof names !== "object") {
    throw new Error("That NIP-05 response has no names map.");
  }
  const pubkey =
    names[name] || names[name.toLowerCase()] || names[name.toUpperCase()];
  if (!isHex64(pubkey)) {
    throw new Error(`${identifier} does not resolve to a public key.`);
  }
  return pubkey.toLowerCase();
}

export async function verifyNip05(identifier, pubkey) {
  if (!isNip05(identifier)) {
    return { status: "invalid", error: "NIP-05 must look like name@domain.com." };
  }
  try {
    const resolved = await resolveNip05(identifier);
    return resolved === String(pubkey).toLowerCase()
      ? { status: "verified", resolved }
      : { status: "mismatch", resolved };
  } catch (error) {
    return {
      status: "unverified",
      error: (error && error.message) || "Could not verify this address.",
    };
  }
}

export function buildNip05Setup(identifier, pubkey, relays) {
  const value = String(identifier || "").trim();
  if (!isNip05(value)) {
    return { error: "Enter an address like name@yourdomain.com." };
  }
  const [name, domain] = value.split("@");
  const json = {
    names: { [name]: pubkey },
    relays: { [pubkey]: relays.slice(0, 6) },
  };
  return {
    name,
    domain,
    fileUrl: `https://${domain}/.well-known/nostr.json`,
    verifyUrl: `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(
      name
    )}`,
    json,
    text: JSON.stringify(json, null, 2),
  };
}
