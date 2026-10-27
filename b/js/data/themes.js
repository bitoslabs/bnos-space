/**
 * Portfolio themes. The id is published inside the NIP-78 event, so the
 * public page can apply the owner's chosen look without a stylesheet per user.
 */
export const DEFAULT_THEME = "obsidian";

export const THEMES = [
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Spotlight layout: featured bento, sticky details, dark gold glass.",
    layout: "showcase",
    layoutName: "Spotlight",
    mode: "dark",
    color: "#0a0a12",
    colors: { dark: "#0a0a12", light: "#f6f7fb" },
  },
  {
    id: "parchment",
    name: "Parchment",
    description: "Editorial layout: single-column paper, alternating work rows.",
    layout: "editorial",
    layoutName: "Editorial",
    mode: "light",
    color: "#f4efe6",
    colors: { light: "#f4efe6", dark: "#17120e" },
  },
  {
    id: "signal",
    name: "Signal",
    description: "Dossier layout: compact terminal grid and a dense media wall.",
    layout: "dossier",
    layoutName: "Dossier",
    mode: "dark",
    color: "#05070a",
    colors: { dark: "#05070a", light: "#f4f8fa" },
  },
];

const THEME_IDS = new Set(THEMES.map((theme) => theme.id));

export function isTheme(value) {
  return THEME_IDS.has(String(value || ""));
}

export function normalizeTheme(value) {
  const id = String(value || "");
  return THEME_IDS.has(id) ? id : DEFAULT_THEME;
}

export function themeMeta(value) {
  const id = normalizeTheme(value);
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}

export function layoutForTheme(value) {
  return themeMeta(value).layout;
}
