/**
 * Best-effort discovery of recently published portfolios.
 *
 * This asks the user's configured relays for kind 30078 events carrying the
 * portfolio d-tag. It is not a global index: relay tag-filter support varies.
 */
import { D_TAG, KIND } from "../config.js";
import { verifyEvent } from "../nostr/crypto.js";
import { queryRelays } from "../nostr/relay.js";
import { parseProfileEvent } from "../data/profile-model.js";
import { hexToNpub, isHex64 } from "../shared/bech32.js";

function isValidEvent(event) {
  if (!event || event.kind !== KIND || !isHex64(event.pubkey)) return false;
  if (!Array.isArray(event.tags)) return false;
  if (
    !event.tags.some(
      (tag) => Array.isArray(tag) && tag[0] === "d" && tag[1] === D_TAG
    )
  ) {
    return false;
  }
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

/**
 * @returns {{items: Array, errors: Array, nextUntil: number|null}}
 */
export async function discoverRecent(
  relays,
  { limit = 9, until = null } = {}
) {
  const filter = {
    kinds: [KIND],
    "#d": [D_TAG],
    limit: 50,
  };
  if (until) filter.until = until;

  const { events, errors } = await queryRelays(relays, filter);
  const byAuthor = new Map();

  for (const event of events) {
    if (!isValidEvent(event)) continue;
    const pubkey = event.pubkey.toLowerCase();
    const existing = byAuthor.get(pubkey);
    if (existing && (existing.created_at || 0) >= (event.created_at || 0)) {
      continue;
    }
    const profile = parseProfileEvent(event);
    if (!isDiscoverable(profile)) continue;
    byAuthor.set(pubkey, { event, profile });
  }

  const all = Array.from(byAuthor.entries())
    .map(([pubkey, entry]) => ({
      pubkey,
      npub: hexToNpub(pubkey),
      profile: entry.profile,
      updatedAt: entry.event.created_at || 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const items = all.slice(0, limit);
  const nextUntil =
    all.length >= limit && items.length
      ? items[items.length - 1].updatedAt - 1
      : null;

  return { items, errors, nextUntil };
}
