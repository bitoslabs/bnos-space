/**
 * Presentation-only formatting helpers.
 */
export function profileName(profile) {
  return (profile && (profile.name || profile.displayName)) || "Unnamed profile";
}

export function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "·";
  return parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toUpperCase();
}

export function shortKey(value) {
  const str = String(value || "");
  if (str.length <= 24) return str;
  return `${str.slice(0, 12)}…${str.slice(-6)}`;
}

export function timeAgo(seconds) {
  if (!seconds) return "";
  const then = Number(seconds);
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - then));
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 30 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 365 * 86400) {
    return `${Math.floor(diff / (30 * 86400))}mo ago`;
  }
  return `${Math.floor(diff / (365 * 86400))}y ago`;
}

export function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function makeId(prefix = "pr") {
  try {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function paragraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeParagraph(part)}</p>`)
    .join("");
}

function escapeParagraph(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}
