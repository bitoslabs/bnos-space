/**
 * Local, dependency-free i18n. English strings are the fallback keys, so a
 * missing translation never hides content. Long or HTML-bearing copy uses
 * semantic keys (`landing.lead`) with an explicit English entry.
 */
import {
  DEFAULT_LANG,
  LANGUAGES,
  MESSAGES,
  STORAGE_KEY,
} from "../data/i18n.js";

const VALID = new Set(LANGUAGES.map((item) => item.id));
let current = DEFAULT_LANG;

function fromUrl() {
  try {
    const lang = new URLSearchParams(location.search).get("lang");
    return VALID.has(lang) ? lang : "";
  } catch {
    return "";
  }
}

function fromStorage() {
  try {
    const lang = localStorage.getItem(STORAGE_KEY);
    return VALID.has(lang) ? lang : "";
  } catch {
    return "";
  }
}

export function getLang() {
  return current;
}

export function initLang() {
  current = fromUrl() || fromStorage() || DEFAULT_LANG;
  document.documentElement.lang = current;
  return current;
}

export function setLang(lang, { reload = true } = {}) {
  const next = VALID.has(lang) ? lang : DEFAULT_LANG;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable */
  }
  document.documentElement.lang = next;
  if (!reload) {
    applyTranslations();
    return;
  }
  try {
    const url = new URL(location.href);
    url.searchParams.set("lang", next);
    location.assign(url.toString());
  } catch {
    location.reload();
  }
}

export function t(key, vars) {
  const table = MESSAGES[current] || {};
  let text = Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : key;
  if (typeof text !== "string") text = String(text);
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match
    );
  }
  return text;
}

const ATTRS = [
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-aria", "aria-label"],
  ["data-i18n-title", "title"],
];

function translateElement(element) {
  const key = element.getAttribute("data-i18n");
  if (key) element.textContent = t(key);

  const htmlKey = element.getAttribute("data-i18n-html");
  if (htmlKey) element.innerHTML = t(htmlKey);

  for (const [attribute, target] of ATTRS) {
    const value = element.getAttribute(attribute);
    if (value) element.setAttribute(target, t(value));
  }
}

export function applyTranslations(root = document) {
  document.documentElement.lang = current;
  root.querySelectorAll("[data-i18n], [data-i18n-html]").forEach(
    translateElement
  );
  root.querySelectorAll(
    "[data-i18n-placeholder], [data-i18n-aria], [data-i18n-title]"
  ).forEach(translateElement);

  const titleKey = document.documentElement.getAttribute("data-i18n-title-key");
  if (titleKey) document.title = t(titleKey);

  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute("content", t("meta.description"));
  const ogDescription = document.getElementById("og-description");
  if (ogDescription) {
    ogDescription.setAttribute("content", t("meta.ogDescription"));
  }

  document.querySelectorAll("[data-lang]").forEach((element) => {
    const active = element.getAttribute("data-lang") === current;
    element.classList.toggle("is-active", active);
    if (active) element.setAttribute("aria-current", "true");
    else element.removeAttribute("aria-current");
  });

  const select = document.getElementById("lang-select");
  if (select) select.value = current;
}

export function languageOptions() {
  return LANGUAGES.map((item) => ({ ...item }));
}
