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
import { GLO_LOCATION_KIND, GLO_LOCATION_TOPIC, GLO_ORG_TOPIC, gloLocation, parseGloOrganization } from "../data/glo.js";
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

function isOrgEventFor(event, pubkey, orgId) {
  if (!belongsTo(event, pubkey) || !safeVerify(event)) return false;
  if (!orgId) return Boolean(parseGloOrganization(event));
  const orgTag = Array.isArray(event.tags)
    ? event.tags.find(
        (tag) => Array.isArray(tag) && tag[0] === "organization" && typeof tag[1] === "string",
      )
    : null;
  return Boolean(orgTag && orgTag[1] === orgId && parseGloOrganization(event));
}

export async function loadProfileFromRelays(pubkey, relays, { orgId = "" } = {}) {
  const [portfolioResult, metaResult, gloResult, locationResult] = await Promise.all([
    queryRelays(relays, {
      kinds: [KIND],
      authors: [pubkey],
      "#d": [D_TAG],
      limit: 5,
    }),
    queryRelays(relays, { kinds: [0], authors: [pubkey], limit: 1 }),
    // bnos-svelte shops: GLO organization events (kind 30078, glo:type:organization).
    queryRelays(relays, {
      kinds: [KIND],
      authors: [pubkey],
      "#t": [GLO_ORG_TOPIC],
      limit: 5,
    }),
    // Branch records (kind 30600) carry the shop address.
    queryRelays(relays, {
      kinds: [GLO_LOCATION_KIND],
      authors: [pubkey],
      "#t": [GLO_LOCATION_TOPIC],
      limit: 10,
    }),
  ]);

  const portfolioEvent = newestEvent(
    portfolioResult.events.filter((event) => isPortfolioEvent(event, pubkey))
  );
  const parsed = portfolioEvent ? parseProfileEvent(portfolioEvent) : null;
  const profile = hasPortfolioContent(parsed) ? parsed : null;

  // Fall back to the shop's GLO organization record when no presence page
  // was published (shops registered through the bnos-svelte console).
  // `orgId` selects one specific company when a key owns several.
  const gloEvents = gloResult.events.filter((event) => isOrgEventFor(event, pubkey, orgId));
  const gloEvent = newestEvent(gloEvents);
  const resolvedEvent = portfolioEvent || gloEvent;
  let resolvedProfile =
    profile || (gloEvent ? parseGloOrganization(gloEvent) : null);

  // Attach the branch address to GLO shop detail pages that lack one.
  if (!profile && resolvedProfile && !resolvedProfile.location) {
    const locationEvent = newestEvent(
      locationResult.events.filter(
        (event) => belongsTo(event, pubkey) && safeVerify(event) && gloLocation(event)
      )
    );
    const location = locationEvent ? gloLocation(locationEvent) : null;
    if (location) resolvedProfile.location = location.address;
  }

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
  const merged = mergeProfileFallback(resolvedProfile, meta);

  const errors = [
    ...portfolioResult.errors,
    ...metaResult.errors,
    ...gloResult.errors,
    ...locationResult.errors,
  ];
  const totalRequests = relays.length * 4;
  return {
    profile: merged,
    createdAt: resolvedEvent ? resolvedEvent.created_at || 0 : 0,
    event: resolvedEvent,
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
