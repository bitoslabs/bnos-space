/**
 * Cryptographic helpers from the vendored nostr-tools bundle.
 *
 * Keeping this in one module makes the dependency boundary explicit and
 * lets the rest of the app stay free of crypto imports.
 */
export {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
  nip44,
} from "../../vendor/nostr-tools.js";
