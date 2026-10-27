/**
 * Read model for a public portfolio. Verifies event signatures before any
 * remote content reaches the UI.
 */
import { D_TAG, KIND, SITE_ORIGIN } from "../config.js";
import { newestEvent, queryRelays } from "../nostr/relay.js";
import { verifyEvent } from "../nostr/crypto.js";
import { verifyNip05 } from "../nostr/nip05.js";
import { hexToNpub } from "../shared/bech32.js";
import { portfolioUrl } from "../shared/urls.js";
import {
  mergeProfileFallback,
  normalizeProfile,
  parseKind0,
  parseProfileEvent,
} from "../data/profile-model.js";
import { readCache, writeCache } from "../data/storage.js";

function safeVerify(event) {
  try {
    return Boolean(event) && verifyEvent(event);
  } catch {
    return false;
  }
}

function hasPortfolioContent(profile) {
  if (!profile) return false;
  return Boolean(
    profile.name ||
      profile.displayName ||
      profile.headline ||
      profile.bio ||
      (profile.projects && profile.projects.length) ||
      (profile.gallery && profile.gallery.length) ||
      (profile.skills && profile.skills.length)
  );
}

function belongsTo(event, pubkey) {
  return (
    event &&
    String(event.pubkey || "").toLowerCase() === String(pubkey).toLowerCase()
  );
}

function isPortfolioEvent(event, pubkey) {
  if (!belongsTo(event, pubkey) || event.kind !== KIND) return false;
  if (!Array.isArray(event.tags)) return false;
  const d = event.tags.find(
    (tag) => Array.isArray(tag) && tag[0] === "d"
  );
  return Boolean(d && d[1] === D_TAG) && safeVerify(event);
}

export function loadCachedProfile(pubkey) {
  const cached = readCache(pubkey);
  if (!cached) return null;
  return {
    profile: normalizeProfile(cached.profile),
    createdAt: cached.created_at || 0,
  };
}

export function saveProfileCache(pubkey, profile, createdAt) {
  writeCache(pubkey, profile, createdAt);
}

export async function loadProfileFromRelays(pubkey, relays) {
  const [portfolioResult, metaResult] = await Promise.all([
    queryRelays(relays, {
      kinds: [KIND],
      authors: [pubkey],
      "#d": [D_TAG],
      limit: 5,
    }),
    queryRelays(relays, { kinds: [0], authors: [pubkey], limit: 1 }),
  ]);

  const portfolioEvent = newestEvent(
    portfolioResult.events.filter((event) => isPortfolioEvent(event, pubkey))
  );
  const parsed = portfolioEvent ? parseProfileEvent(portfolioEvent) : null;
  const profile = hasPortfolioContent(parsed) ? parsed : null;

  const metaEvent = newestEvent(
    metaResult.events.filter(
      (event) =>
        event &&
        event.kind === 0 &&
        belongsTo(event, pubkey) &&
        safeVerify(event)
    )
  );
  const meta = metaEvent ? parseKind0(metaEvent) : null;
  const merged = mergeProfileFallback(profile, meta);

  const errors = [...portfolioResult.errors, ...metaResult.errors];
  const totalRequests = relays.length * 2;
  return {
    profile: merged,
    createdAt: portfolioEvent ? portfolioEvent.created_at || 0 : 0,
    event: portfolioEvent,
    meta,
    errors,
    allFailed: totalRequests > 0 && errors.length >= totalRequests,
  };
}

export async function checkNip05(profile, pubkey, fromRef = "") {
  const identifier = (profile && profile.nip05) || "";
  if (!identifier) return { status: "none" };
  if (
    fromRef &&
    fromRef.toLowerCase() === identifier.toLowerCase()
  ) {
    return { status: "verified", resolved: pubkey };
  }
  const result = await verifyNip05(identifier, pubkey);
  return result;
}

export function canonicalRef(profile, pubkey, nip05Status) {
  if (profile && profile.nip05 && nip05Status === "verified") {
    return profile.nip05;
  }
  return pubkey ? hexToNpub(pubkey) : "";
}

export function canonicalUrl(ref, options = {}) {
  return `${SITE_ORIGIN}${portfolioUrl(ref, options)}`;
}

export function displayUrl(ref) {
  return `bnos.space/b/${ref || ""}`;
}
