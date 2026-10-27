/**
 * Theme preference. The inline boot script applies the site mode before paint;
 * this module owns the site toggle, the published portfolio style, the
 * visitor's dark/light override and the browser theme-color metadata.
 */
import { getTheme, setTheme } from "../data/storage.js";
import { normalizeTheme, themeMeta } from "../data/themes.js";
import { t } from "../shared/i18n.js";

const SITE_COLORS = { dark: "#0a0a12", light: "#f6f7fb" };
const LEGACY_PORTFOLIO_MODE = "portfolio-mode";

let siteTheme = "dark";
let preferredMode = "";
let portfolioTheme = "";
let toggleButton = null;

function storedTheme() {
  try {
    const saved = localStorage.getItem("bnos_theme");
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

function migrateLegacyPortfolioMode() {
  try {
    const legacy = localStorage.getItem(LEGACY_PORTFOLIO_MODE);
    if (!legacy) return;
    if (!storedTheme() && (legacy === "light" || legacy === "dark")) {
      setTheme(legacy);
    }
    localStorage.removeItem(LEGACY_PORTFOLIO_MODE);
  } catch {
    /* storage may be unavailable */
  }
}

function paint() {
  const theme = portfolioTheme ? themeMeta(portfolioTheme) : null;
  const mode = theme ? preferredMode || theme.mode : siteTheme;
  const isLight = mode === "light";
  const root = document.documentElement;

  root.classList.toggle("light-mode", isLight);
  if (theme) {
    root.setAttribute("data-portfolio-theme", theme.id);
    root.setAttribute("data-portfolio-mode", mode);
  } else {
    root.removeAttribute("data-portfolio-theme");
    root.removeAttribute("data-portfolio-mode");
  }

  if (toggleButton) {
    const label = isLight ? t("Switch to dark theme") : t("Switch to light theme");
    toggleButton.setAttribute("aria-label", label);
    toggleButton.setAttribute("title", label);
  }

  const meta = document.getElementById("theme-color");
  if (meta) {
    meta.setAttribute(
      "content",
      theme
        ? (theme.colors && theme.colors[mode]) || theme.color
        : SITE_COLORS[siteTheme]
    );
  }

  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute("content", isLight ? "light" : "dark");
}

function toggleMode() {
  siteTheme = document.documentElement.classList.contains("light-mode")
    ? "dark"
    : "light";
  preferredMode = siteTheme;
  setTheme(siteTheme);
  paint();
}

export function initTheme(button) {
  toggleButton = button || null;
  migrateLegacyPortfolioMode();
  siteTheme = getTheme();
  preferredMode = storedTheme() || "";
  paint();

  if (toggleButton) {
    toggleButton.addEventListener("click", toggleMode);
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== "bnos_theme") return;
    siteTheme = storedTheme() || "dark";
    preferredMode = storedTheme() || "";
    paint();
  });
}

export function applyPortfolioTheme(theme) {
  portfolioTheme = theme ? normalizeTheme(theme) : "";
  paint();
}

export function resetPortfolioTheme() {
  portfolioTheme = "";
  paint();
}
