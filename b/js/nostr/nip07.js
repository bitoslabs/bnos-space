/**
 * NIP-07 browser signer. The private key never enters this page.
 */
import { isHex64 } from "../shared/bech32.js";

export function hasSigner() {
  return Boolean(
    window.nostr && typeof window.nostr.getPublicKey === "function"
  );
}

export async function getPublicKey() {
  if (!hasSigner()) {
    throw new Error(
      "No NIP-07 signer detected. Install a browser extension such as Alby or nos2x, then reload this page."
    );
  }
  const pubkey = String(await window.nostr.getPublicKey()).toLowerCase();
  if (!isHex64(pubkey)) throw new Error("The signer returned an invalid key.");
  return pubkey;
}

export async function signEvent(event) {
  if (!hasSigner() || typeof window.nostr.signEvent !== "function") {
    throw new Error("Connect a NIP-07 signer to publish.");
  }
  return window.nostr.signEvent(event);
}
