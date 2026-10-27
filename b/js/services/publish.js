/**
 * Publish orchestration: validate, build the NIP-78 event, sign through the
 * active signer, and write it to the selected relays.
 */
import { D_TAG, KIND, PROFILE_TYPE_TAGS } from "../config.js?v=13";
import { publishToRelays } from "../nostr/relay.js";
import { verifyEvent } from "../nostr/crypto.js";
import {
  toPublicProfile,
  validateProfile,
} from "../data/profile-model.js?v=13";
import * as auth from "./auth.js";

export function buildPortfolioEvent(publicProfile, createdAt) {
  const name =
    publicProfile.name || publicProfile.displayName || "business";
  const type =
    publicProfile.type === "organization" ? "organization" : "personal";
  const tags = [
    ["d", D_TAG],
    ["t", "bnos-business"],
    ["t", PROFILE_TYPE_TAGS[type]],
    ["client", "bnos.space"],
    ["alt", `Business presence for ${name}`],
  ];
  if (publicProfile.nip05) tags.push(["nip05", publicProfile.nip05]);

  return {
    kind: KIND,
    created_at: createdAt || Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(publicProfile),
  };
}

export async function publishProfile(
  profile,
  relays,
  { onPhase = () => {} } = {}
) {
  const validationError = validateProfile(profile);
  if (validationError) throw new Error(validationError);

  const pubkey = auth.getState().pubkey;
  if (!pubkey) throw new Error("Connect a signer before publishing.");

  const publicProfile = toPublicProfile(profile);
  const unsigned = buildPortfolioEvent(publicProfile);
  onPhase("signing");
  const signed = await auth.signEvent(unsigned);

  if (!signed || !signed.id || !signed.sig) {
    throw new Error("The signer did not return a signed event.");
  }
  if (String(signed.pubkey || "").toLowerCase() !== pubkey) {
    throw new Error("The signer returned a different public key.");
  }
  if (!verifyEvent(signed)) {
    throw new Error("The signer returned an invalid signature.");
  }
  if (
    signed.kind !== KIND ||
    !Array.isArray(signed.tags) ||
    !signed.tags.some((tag) => Array.isArray(tag) && tag[0] === "d" && tag[1] === D_TAG)
  ) {
    throw new Error("The signer returned an unexpected event.");
  }

  onPhase("publishing", { done: 0, total: relays.length });
  const results = await publishToRelays(relays, signed, {
    onProgress: ({ done, total }) => onPhase("publishing", { done, total }),
  });
  const accepted = results.filter((result) => result.ok).length;
  return { signed, results, accepted, publicProfile };
}
