/**
 * Local-key signer. The nsec never leaves this module except for the explicit
 * backup screen, and is only persisted when the user asks to remember it.
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from "./crypto.js";
import {
  hexToNpub,
  hexToNsec,
  isHex64,
  nsecToHex,
} from "../shared/bech32.js";

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  if (!isHex64(hex)) throw new Error("Invalid secret key.");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function parseSecretKey(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new Error("Enter your nsec or a 64-character secret key.");
  }
  let secretHex;
  if (/^nsec1/i.test(raw)) {
    secretHex = nsecToHex(raw);
  } else if (isHex64(raw)) {
    secretHex = raw.toLowerCase();
  } else {
    throw new Error("Enter a valid nsec or 64-character secret key.");
  }
  const secretBytes = hexToBytes(secretHex);
  const pubkey = String(getPublicKey(secretBytes)).toLowerCase();
  if (!isHex64(pubkey)) throw new Error("Could not derive the public key.");
  return {
    secretHex,
    pubkey,
    npub: hexToNpub(pubkey),
    nsec: hexToNsec(secretHex),
  };
}

export function generateLocalAccount() {
  const secretBytes = generateSecretKey();
  const secretHex = bytesToHex(secretBytes);
  const pubkey = String(getPublicKey(secretBytes)).toLowerCase();
  return {
    secretHex,
    pubkey,
    npub: hexToNpub(pubkey),
    nsec: hexToNsec(secretHex),
  };
}

export function signWithSecretKey(event, secretHex) {
  return finalizeEvent(event, hexToBytes(secretHex));
}
