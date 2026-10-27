/**
 * The signed-in user's own business page status.
 */
import {
  loadProfileFromRelays,
  saveProfileCache,
} from "./profile.js";

export async function fetchMyPortfolio(pubkey, relays) {
  const result = await loadProfileFromRelays(pubkey, relays);
  if (result.profile) {
    saveProfileCache(pubkey, result.profile, result.createdAt);
    return {
      status: "published",
      profile: result.profile,
      updatedAt: result.createdAt,
    };
  }
  if (result.allFailed) return { status: "error" };
  return {
    status: "empty",
    profile: result.meta || null,
    meta: result.meta || null,
  };
}
