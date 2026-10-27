/**
 * Application constants shared by the business presence app.
 */
export const KIND = 30078;
export const D_TAG = "bnos.space:business:v1";

export const NIP46_KIND = 24133;
export const NIP46_PERMS = "sign_event:30078";
export const NIP46_APPROVAL_TIMEOUT = 120_000;
export const NIP46_CONNECT_TIMEOUT = 180_000;
export const NIP46_SHORT_TIMEOUT = 10_000;

export const RELAY_QUERY_TIMEOUT = 5_000;
export const RELAY_PUBLISH_TIMEOUT = 6_000;
export const RELAY_SUBSCRIBE_TIMEOUT = 8_000;

export const DEFAULT_RELAYS = [
  "wss://nostr-01.yakihonne.com",
  "wss://relay.bitos.space",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

export const SITE_ORIGIN = "https://bnos.space";
export const BLOSSOM_SERVER = "https://blossom.primal.net";
export const MEDIA_UPLOAD_URL =
  "https://social.bitos.space/api/media/upload";

export const PROFILE_TYPE_TAGS = {
  personal: "bnos-solo-provider",
  organization: "bnos-organization",
};

export const CLIENT_METADATA = {
  name: "BNOS Business Presence",
  url: `${SITE_ORIGIN}/b/`,
};

export const AVAILABILITY = {
  available: { label: "Accepting inquiries", dot: "" },
  open: { label: "Open for projects", dot: "" },
  select: { label: "Selected clients only", dot: "amber" },
  unavailable: { label: "Not accepting work", dot: "muted" },
};

export const STORAGE = {
  theme: "bnos_theme",
  signer: "bnos.signer",
  pubkey: "bnos.pubkey",
  relays: "bnos.relays",
  auth: "bnos.auth.v2",
  draft: (pubkey) => `bnos.business.draft.${pubkey}`,
  cache: (pubkey) => `bnos.business.cache.${pubkey}`,
  blossom: "bnos.blossom.server",
};
