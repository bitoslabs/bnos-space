/**
 * Portfolio data model: the shape published in kind 30078, normalization of
 * untrusted remote JSON, public filtering and publish-time validation.
 */
import { contactUrl, httpUrl, isNip05 } from "../shared/urls.js";
import { clone } from "../shared/clone.js";
import {
  GALLERY_LIMIT,
  INLINE_IMAGE_BUDGET,
  formatBytes,
  inferMediaType,
  inlineImageBytes,
  isDataImage,
  isGalleryMediaUrl,
} from "../shared/media.js";
import { normalizeTheme } from "./themes.js";

export function emptyProfile() {
  return {
    version: 1,
    type: "organization",
    name: "",
    displayName: "",
    nip05: "",
    headline: "",
    bio: "",
    location: "",
    timezone: "",
    languages: [],
    availability: { status: "", note: "" },
    avatar: "",
    banner: "",
    contact: { label: "", url: "" },
    links: [],
    skills: [],
    projects: [],
    gallery: [],
    credentials: [],
    theme: normalizeTheme(""),
  };
}

function text(value, max = 500) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function normalizeProfile(raw) {
  const profile = emptyProfile();
  if (!raw || typeof raw !== "object") return profile;

  profile.type = raw.type === "organization" ? "organization" : "personal";
  profile.name = text(raw.name, 80);
  profile.displayName = text(raw.displayName || raw.display_name, 40);
  profile.nip05 = text(raw.nip05, 120);
  profile.theme = normalizeTheme(raw.theme);
  profile.headline = text(raw.headline || raw.about, 160);
  profile.bio = text(raw.bio || raw.about, 2000);
  profile.location = text(raw.location, 80);
  profile.timezone = text(raw.timezone, 40);
  profile.avatar = text(raw.avatar || raw.picture, 500);
  profile.banner = text(raw.banner, 500);
  profile.slug = text(raw.slug, 40);
  profile.languages = Array.isArray(raw.languages)
    ? raw.languages.map((item) => text(item, 24)).filter(Boolean).slice(0, 8)
    : [];

  const availability =
    typeof raw.availability === "string"
      ? { status: raw.availability, note: "" }
      : raw.availability && typeof raw.availability === "object"
      ? {
          status: text(raw.availability.status, 20),
          note: text(raw.availability.note, 120),
        }
      : { status: "", note: "" };
  profile.availability = availability;

  const contact =
    raw.contact && typeof raw.contact === "object" ? raw.contact : {};
  profile.contact = {
    label: text(contact.label, 60),
    url: text(contact.url, 500),
  };

  profile.links = Array.isArray(raw.links)
    ? raw.links
        .map((item) => ({
          label: text(item && item.label, 60),
          url: text(item && item.url, 500),
        }))
        .filter((item) => item.url)
        .slice(0, 20)
    : [];

  profile.skills = Array.isArray(raw.skills)
    ? raw.skills
        .map((item) => ({
          name: text(item && item.name, 60),
          evidence: item && item.evidence === "issuer" ? "issuer" : "self",
          issuer: text(item && item.issuer, 120),
        }))
        .filter((item) => item.name)
        .slice(0, 30)
    : [];

  profile.projects = Array.isArray(raw.projects)
    ? raw.projects
        .map((item, index) => {
          const project = item && typeof item === "object" ? item : {};
          return {
            id: text(project.id, 40) || `pr_${index}`,
            title: text(project.title, 120),
            summary: text(project.summary, 400),
            description: text(project.description, 4000),
            role: text(project.role, 120),
            contribution: text(project.contribution, 200),
            year: text(project.year, 40),
            tags: Array.isArray(project.tags)
              ? project.tags
                  .map((tag) => text(tag, 30))
                  .filter(Boolean)
                  .slice(0, 10)
              : [],
            link: text(project.link, 500),
            media: text(project.media, 500),
            public: project.public !== false,
          };
        })
        .filter((item) => item.title || item.summary || item.description)
        .slice(0, 40)
    : [];

  profile.gallery = Array.isArray(raw.gallery)
    ? raw.gallery
        .map((item, index) => {
          const media = item && typeof item === "object" ? item : {};
          const url = text(media.url || media.src, 1_600_000);
          const declared = media.type === "video" ? "video" : "image";
          const type =
            declared === "video" || inferMediaType(url) === "video"
              ? "video"
              : "image";
          return {
            id: text(media.id, 40) || `md_${index}`,
            type,
            url,
            poster: isDataImage(media.poster)
              ? String(media.poster).slice(0, 700000)
              : text(media.poster, 500),
            caption: text(media.caption || media.title, 160),
            alt: text(media.alt, 160),
            public: media.public !== false,
            reel: media.reel === true,
          };
        })
        .filter((item) => item.url)
        .slice(0, GALLERY_LIMIT)
    : [];

  profile.credentials = Array.isArray(raw.credentials)
    ? raw.credentials
        .map((item, index) => {
          const credential = item && typeof item === "object" ? item : {};
          return {
            id: text(credential.id, 60) || `cr_${index}`,
            title: text(credential.title, 120),
            issuer: text(credential.issuer, 120),
            year: text(credential.year, 40),
            status: text(credential.status, 60),
            note: text(credential.note, 200),
            public: credential.public !== false,
          };
        })
        .filter((item) => item.title)
        .slice(0, 20)
    : [];

  return profile;
}

/**
 * Fill identity fields that the portfolio omits from the user's kind 0
 * metadata. The portfolio event stays authoritative; kind 0 is only a
 * fallback so avatars, NIP-05 and names set in other clients still appear.
 */
export function mergeProfileFallback(profile, fallback) {
  if (!profile || !fallback) return profile;
  return {
    ...profile,
    name: profile.name || fallback.name,
    displayName: profile.displayName || fallback.displayName,
    headline: profile.headline || fallback.headline,
    bio: profile.bio || fallback.bio,
    nip05: profile.nip05 || fallback.nip05,
    avatar: profile.avatar || fallback.avatar,
    banner: profile.banner || fallback.banner,
    links: profile.links && profile.links.length ? profile.links : fallback.links,
  };
}

export function parseProfileEvent(event) {
  if (!event || !event.content) return null;
  try {
    return normalizeProfile(JSON.parse(event.content));
  } catch {
    return null;
  }
}

export function parseKind0(event) {
  if (!event || !event.content) return null;
  try {
    const data = JSON.parse(event.content);
    if (!data || typeof data !== "object") return null;
    return normalizeProfile({
      name: data.name,
      displayName: data.display_name,
      nip05: data.nip05,
      headline: data.about ? String(data.about).slice(0, 160) : "",
      bio: data.about,
      avatar: data.picture,
      banner: data.banner,
      links: data.website ? [{ label: "Website", url: data.website }] : [],
    });
  } catch {
    return null;
  }
}

export function toPublicProfile(profile) {
  const out = clone(profile);
  delete out.draftUpdatedAt;
  out.version = 1;
  out.links = (out.links || []).filter((link) => httpUrl(link.url));
  out.skills = (out.skills || []).filter((skill) => skill.name);
  out.projects = (out.projects || [])
    .filter(
      (project) =>
        project.public !== false &&
        (project.title || project.summary || project.description)
    )
    .map((project) => {
      const copy = { ...project };
      delete copy.public;
      return copy;
    });
  out.theme = normalizeTheme(out.theme);
  out.gallery = (out.gallery || [])
    .filter(
      (item) =>
        item.public !== false &&
        isGalleryMediaUrl(item.url, item.type === "video" ? "video" : "image")
    )
    .map((item) => {
      const copy = { ...item };
      delete copy.public;
      if (copy.reel !== true) delete copy.reel;
      return copy;
    });
  out.credentials = (out.credentials || [])
    .filter(
      (credential) =>
        credential.public !== false &&
        (credential.title || credential.issuer)
    )
    .map((credential) => {
      const copy = { ...credential };
      delete copy.public;
      return copy;
    });
  return out;
}

export function validateProfile(profile) {
  if (!profile.name.trim() && !profile.displayName.trim()) {
    return "Add a name before publishing.";
  }
  if (profile.nip05 && !isNip05(profile.nip05)) {
    return "NIP-05 must look like name@domain.com.";
  }
  if (profile.avatar && !httpUrl(profile.avatar)) {
    return "Avatar URL must start with http:// or https://.";
  }
  if (profile.banner && !httpUrl(profile.banner)) {
    return "Banner URL must start with http:// or https://.";
  }
  if (profile.contact.url && !contactUrl(profile.contact.url)) {
    return "Contact link must be an https:// or mailto: link.";
  }
  for (const link of profile.links || []) {
    if (link.url && !httpUrl(link.url)) {
      return `Link "${link.label || link.url}" must start with http:// or https://.`;
    }
  }
  for (const project of profile.projects || []) {
    const isPublic = project.public !== false;
    const hasContent =
      project.title || project.summary || project.description;
    if (!isPublic || !hasContent) continue;
    if (!project.title.trim()) {
      return "Every published case study needs a title.";
    }
    if (project.link && !httpUrl(project.link)) {
      return `Case study "${project.title}" has an invalid link.`;
    }
    if (project.media && !httpUrl(project.media)) {
      return `Case study "${project.title}" has an invalid cover image URL.`;
    }
  }
  for (const item of profile.gallery || []) {
    if (item.public === false) continue;
    const label = item.caption || item.alt || "Gallery item";
    if (!item.url) {
      return `${label} needs an image or video URL.`;
    }
    if (
      !isGalleryMediaUrl(
        item.url,
        item.type === "video" ? "video" : "image"
      )
    ) {
      return item.type === "video"
        ? `${label} needs a direct https:// video URL (MP4 or WebM).`
        : `${label} needs a valid image URL or an uploaded image.`;
    }
    if (item.poster && !httpUrl(item.poster)) {
      return `${label} has an invalid poster URL.`;
    }
  }
  const inlineBytes = inlineImageBytes(profile.gallery || []);
  if (inlineBytes > INLINE_IMAGE_BUDGET) {
    return `Inline gallery images use ${formatBytes(
      inlineBytes
    )}; remove an image or use a hosted URL (inline limit ${formatBytes(
      INLINE_IMAGE_BUDGET
    )}).`;
  }
  for (const credential of profile.credentials || []) {
    if (
      credential.public !== false &&
      (credential.title || credential.issuer) &&
      !credential.title.trim()
    ) {
      return "Every published credential needs a title.";
    }
  }
  return "";
}
