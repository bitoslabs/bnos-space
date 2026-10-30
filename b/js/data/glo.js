/**
 * GLO (Global Ledger of Businesses) organization adapter.
 *
 * The bnos-svelte console (`apps/bnos-svelte`) publishes every shop as a GLO
 * object per the `@bitos/bnos-core` GLO v1 spec:
 *
 *   kind 30078, d = `org.bitos.glo:v1:organization:<id>`,
 *   t = `glo:type:organization`, content = JSON envelope
 *   { spec, version, type, id, scope, visibility, data }
 *
 * This module validates untrusted GLO events and maps the public ones onto
 * the normalized portfolio profile shape used by the business-pages app.
 */
import { KIND } from "../config.js";
import { normalizeProfile } from "./profile-model.js";

export const GLO_SPEC = "org.bitos.glo";
export const GLO_ORG_TYPE = "organization";
export const GLO_ORG_TOPIC = "glo:type:organization";
export const GLO_LOCATION_TOPIC = "glo:type:location";
export const GLO_LOCATION_KIND = 30600;

function tagValues(event, name) {
  if (!Array.isArray(event.tags)) return [];
  return event.tags
    .filter((tag) => Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1]);
}

function hasTag(event, name) {
  return Array.isArray(event.tags) && event.tags.some((tag) => Array.isArray(tag) && tag[0] === name);
}

/** Structural check only — callers must still verify the signature. */
export function isGloOrganizationEvent(event) {
  if (!event || event.kind !== KIND) return false;
  return tagValues(event, "t").includes(GLO_ORG_TOPIC);
}

/** Structural check for GLO location (branch) events — kind 30600. */
export function isGloLocationEvent(event) {
  if (!event || event.kind !== GLO_LOCATION_KIND) return false;
  return tagValues(event, "t").includes(GLO_LOCATION_TOPIC);
}

/**
 * Parse a verified GLO location event into `{ organizationId, address }`.
 * Branch records carry the shop's address; the directory attaches it to the
 * matching organization card. Returns null for malformed, encrypted, or
 * `private` records — same listing rules as organizations.
 */
export function gloLocation(event) {
  if (!isGloLocationEvent(event)) return null;

  let envelope;
  try {
    envelope = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!envelope || typeof envelope !== "object") return null;
  if (envelope.spec !== GLO_SPEC) return null;
  if (Number(envelope.version) !== 1) return null;
  if (envelope.type !== "location") return null;
  if (envelope.encryption || hasTag(event, "encrypted")) return null;
  if (envelope.visibility !== "public" && envelope.visibility !== "organization") {
    return null;
  }

  const data = envelope.data && typeof envelope.data === "object" ? envelope.data : {};
  const organizationId =
    (envelope.scope && envelope.scope.organizationId) ||
    tagValues(event, "organization")[0] ||
    "";
  const address = typeof data.address === "string" ? data.address.trim().slice(0, 80) : "";
  if (!organizationId || !address) return null;

  return { organizationId, address, createdAt: event.created_at || 0 };
}

/**
 * The shop's original registration time, seconds since epoch. The console
 * stamps `data.createdAt` (ISO) on first publish and preserves it across
 * updates. Returns 0 when the record carries no readable stamp.
 */
export function gloCreatedAt(event) {
  if (!isGloOrganizationEvent(event)) return 0;
  try {
    const envelope = JSON.parse(event.content);
    const stamp = envelope && envelope.data && envelope.data.createdAt;
    const ms = typeof stamp === "string" ? Date.parse(stamp) : Number(stamp);
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.floor(ms / 1000);
  } catch {
    return 0;
  }
}

/**
 * Parse a verified GLO organization event into a normalized profile.
 * Returns null for anything that must not be listed publicly: malformed
 * envelopes, encrypted payloads, or `private` visibility.
 *
 * `public` and `organization` visibilities are both listed: the console
 * (`bnos-svelte`) publishes organization records with the default
 * `organization` visibility, and those records are public-discovery data —
 * they are never encrypted (absent from the console's encrypted-domain map)
 * and are published in plaintext to the shared relays.
 */
export function parseGloOrganization(event) {
  if (!isGloOrganizationEvent(event)) return null;

  let envelope;
  try {
    envelope = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!envelope || typeof envelope !== "object") return null;
  if (envelope.spec !== GLO_SPEC) return null;
  if (Number(envelope.version) !== 1) return null;
  if (envelope.type !== GLO_ORG_TYPE) return null;
  if (envelope.encryption) return null;
  if (hasTag(event, "encrypted")) return null;
  if (envelope.visibility !== "public" && envelope.visibility !== "organization") {
    return null;
  }

  const data = envelope.data && typeof envelope.data === "object" ? envelope.data : {};
  // The console carries businessType / businessModel under the vendor
  // extension namespace (`org.bitos.bnos`), older records under `data`.
  const extensions =
    envelope.extensions && typeof envelope.extensions === "object"
      ? envelope.extensions
      : {};
  const bnosExt =
    extensions["org.bitos.bnos"] && typeof extensions["org.bitos.bnos"] === "object"
      ? extensions["org.bitos.bnos"]
      : {};
  const businessType =
    data.businessType || bnosExt.businessType || bnosExt.businessModel || "";

  return normalizeProfile({
    type: "organization",
    name: data.name,
    displayName: data.legalName,
    headline: data.description,
    bio: data.description,
    location: data.address,
    // Settings publishes the logo in the vendor extension namespace.
    avatar: data.logoUrl || data.picture || bnosExt.logoUrl || "",
    contact: data.email ? { label: "Email", url: `mailto:${data.email}` } : null,
    links: data.website ? [{ label: "Website", url: data.website }] : [],
    skills: businessType ? [{ name: businessType }] : [],
  });
}
