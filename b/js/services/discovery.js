/**
 * Best-effort discovery of recently published businesses.
 *
 * Two public sources are merged, both on kind 30078:
 *
 * 1. Business pages published with the `bnos.space:business:v1` d-tag
 *    (the `b/` presence app).
 * 2. GLO organizations from the bnos-svelte console, tagged
 *    `glo:type:organization` (GLO v1 spec, `@bitos/bnos-core`).
 *
 * It is not a global index: relay tag-filter support varies.
 */
import { D_TAG, KIND } from "../config.js";
import { verifyEvent } from "../nostr/crypto.js";
import { queryRelays } from "../nostr/relay.js";
import { parseProfileEvent } from "../data/profile-model.js";
import {
  GLO_LOCATION_KIND,
  GLO_LOCATION_TOPIC,
  GLO_ORG_TOPIC,
  gloCreatedAt,
  gloLocation,
  parseGloOrganization,
} from "../data/glo.js";
import { hexToNpub, isHex64 } from "../shared/bech32.js";

function isValidEvent(event, kind = KIND) {
  if (!event || event.kind !== kind || !isHex64(event.pubkey)) return false;
  if (!Array.isArray(event.tags)) return false;
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}

function isDiscoverable(profile) {
  if (!profile) return false;
  const named = Boolean(profile.name || profile.displayName);
  const hasContent = Boolean(
    profile.avatar ||
      profile.banner ||
      profile.headline ||
      profile.bio ||
      profile.location ||
      profile.nip05 ||
      (profile.projects && profile.projects.length) ||
      (profile.gallery && profile.gallery.length) ||
      (profile.skills && profile.skills.length) ||
      (profile.links && profile.links.length) ||
      (profile.contact && profile.contact.url) ||
      (profile.availability &&
        (profile.availability.status || profile.availability.note))
  );
  return named && hasContent;
}

/** GLO orgs come from the console's onboarding flow, where a bare record
 * (name + currency + status) is a valid registered shop — a name alone is
 * enough to list it. */
function isListableProfile(profile, source) {
  if (source === "glo") return Boolean(profile && (profile.name || profile.displayName));
  return isDiscoverable(profile);
}

/**
 * @returns {{items: Array, errors: Array, nextUntil: number|null}}
 */
export async function discoverRecent(
  relays,
  { limit = 9, until = null } = {}
) {
  const pageFilter = {
    kinds: [KIND],
    "#d": [D_TAG],
    limit: 50,
  };
  if (until) pageFilter.until = until;

  // GLO organizations (bnos-svelte shops) always fetch the newest window;
  // `until` paging only applies to the presence-page source.
  const gloFilter = {
    kinds: [KIND],
    "#t": [GLO_ORG_TOPIC],
    limit: 50,
  };

  // Branch records (kind 30600) carry the shop address shown on cards.
  const locationFilter = {
    kinds: [GLO_LOCATION_KIND],
    "#t": [GLO_LOCATION_TOPIC],
    limit: 100,
  };

  const [pageResult, gloResult, locationResult] = await Promise.all([
    queryRelays(relays, pageFilter),
    queryRelays(relays, gloFilter),
    queryRelays(relays, locationFilter),
  ]);

  // organizationId → address (newest location record with an address wins).
  const addressByOrg = new Map();
  for (const event of locationResult.events) {
    if (!isValidEvent(event, GLO_LOCATION_KIND)) continue;
    const location = gloLocation(event);
    if (!location) continue;
    const existing = addressByOrg.get(location.organizationId);
    if (!existing || location.createdAt > existing.createdAt) {
      addressByOrg.set(location.organizationId, location);
    }
  }

  /** The GLO organization id an event belongs to (`organization` tag or d-tag). */
  function orgIdOf(event) {
    const orgTag = Array.isArray(event.tags)
      ? event.tags.find(
          (tag) => Array.isArray(tag) && tag[0] === "organization" && typeof tag[1] === "string",
        )
      : null;
    if (orgTag) return orgTag[1];
    const dTag = Array.isArray(event.tags)
      ? event.tags.find((tag) => Array.isArray(tag) && tag[0] === "d" && typeof tag[1] === "string")
      : null;
    if (dTag) {
      const parts = dTag[1].split(":");
      if (parts.length >= 5 && parts[0] === GLO_SPEC) return parts.slice(4).join(":");
    }
    return "";
  }

  // Listing key: one presence page per pubkey, one card per GLO organization
  // (a single key may own several companies in the console).
  const byKey = new Map();
  const pagePubkeys = new Set();

  function collect(events, source, parse) {
    for (const event of events) {
      if (!isValidEvent(event)) continue;
      const pubkey = event.pubkey.toLowerCase();
      if (source === "page") {
        const existing = byKey.get(pubkey);
        if (existing && (existing.event.created_at || 0) >= (event.created_at || 0)) {
          continue;
        }
      } else {
        // A presence page outranks GLO orgs for the same author.
        if (pagePubkeys.has(pubkey)) continue;
        // One card per organization; org ids are client-generated, so scope
        // them by author to avoid cross-key id collisions.
        const key = `glo:${pubkey}:${orgIdOf(event) || ""}`;
        const existing = byKey.get(key);
        if (existing && (existing.event.created_at || 0) >= (event.created_at || 0)) {
          continue;
        }
      }
      const profile = parse(event);
      if (!profile) continue;
      if (!isListableProfile(profile, source)) continue;
      if (source === "page") {
        byKey.delete(pubkey);
        pagePubkeys.add(pubkey);
        byKey.set(pubkey, { event, profile, source });
      } else {
        byKey.set(`glo:${pubkey}:${orgIdOf(event) || ""}`, { event, profile, source });
      }
    }
  }

  collect(pageResult.events, "page", parseProfileEvent);
  collect(gloResult.events, "glo", parseGloOrganization);

  const all = Array.from(byKey.entries())
    .map(([key, entry]) => {
      const pubkey = entry.event.pubkey.toLowerCase();
      const orgId = entry.source === "glo" ? orgIdOf(entry.event) : "";
      // Attach the branch address to org cards that lack one.
      if (entry.source === "glo" && !entry.profile.location) {
        const location = orgId ? addressByOrg.get(orgId) : null;
        if (location) entry.profile.location = location.address;
      }
      return {
        pubkey,
        npub: hexToNpub(pubkey),
        orgId,
        profile: entry.profile,
        source: entry.source,
        updatedAt: entry.event.created_at || 0,
        // True registration time when the record carries one (GLO createdAt);
        // falls back to the event time for presence pages.
        createdAt:
          entry.source === "glo"
            ? gloCreatedAt(entry.event) || entry.event.created_at || 0
            : entry.event.created_at || 0,
      };
    })
    // Newest registered first.
    .sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));

  const items = all.slice(0, limit);
  const nextUntil =
    all.length >= limit && items.length
      ? items[items.length - 1].updatedAt - 1
      : null;

  const errors = [...pageResult.errors, ...gloResult.errors, ...locationResult.errors];

  return { items, errors, nextUntil };
}
