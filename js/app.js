import translations from './i18n.js';

const DEFAULT_LANG = 'en';
const THEME_KEY = 'bnos_theme';

function getNestedTranslation(lang, path) {
  return path.split('.').reduce((obj, key) => obj && obj[key], translations[lang]);
}

/* ------------------------------------------------------------------ *
 * Theme (dark / light). The initial attribute is set by an inline     *
 * script in <head> to avoid a flash; here we only wire the toggle.    *
 * ------------------------------------------------------------------ */
export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

export function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (_) {
    /* storage unavailable — session-only theme */
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#f6f7fb' : '#0a0a12');

  const lang = document.documentElement.lang || DEFAULT_LANG;
  const labels = (translations[lang] && translations[lang].theme) || {};
  const label = next === 'light'
    ? (labels.dark || 'Switch to dark theme')
    : (labels.light || 'Switch to light theme');

  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', next === 'light' ? 'true' : 'false');
    const icon = btn.querySelector('iconify-icon');
    if (icon) icon.setAttribute('icon', next === 'light' ? 'solar:moon-linear' : 'solar:sun-linear');
  });
}

export function toggleTheme() {
  setTheme(getTheme() === 'light' ? 'dark' : 'light');
}

function initTheme() {
  setTheme(getTheme());
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.addEventListener('click', toggleTheme);
  });
}

export function setLanguage(lang) {
  if (!translations[lang]) lang = DEFAULT_LANG;
  
  localStorage.setItem('bnos_lang', lang);
  document.documentElement.lang = lang;
  
  // Update document title
  document.title = translations[lang].meta.title;
  
  // Update meta tags
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = translations[lang].meta.description;
  
  const metaKey = document.querySelector('meta[name="keywords"]');
  if (metaKey) metaKey.content = translations[lang].meta.keywords;
  
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.content = translations[lang].meta.ogTitle;
  
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.content = translations[lang].meta.ogDesc;

  // Update DOM elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = getNestedTranslation(lang, key);
    if (text) {
      if (el.tagName === 'META') {
        el.content = text;
      } else {
        el.innerHTML = text; // allow nested html elements
      }
    }
  });

  // Attribute translations (placeholders, aria-labels, titles)
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const text = getNestedTranslation(lang, el.getAttribute('data-i18n-placeholder'));
    if (text) el.placeholder = text;
  });

  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const text = getNestedTranslation(lang, el.getAttribute('data-i18n-aria'));
    if (text) el.setAttribute('aria-label', text);
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const text = getNestedTranslation(lang, el.getAttribute('data-i18n-title'));
    if (text) el.title = text;
  });

  // Update language switcher active class
  document.querySelectorAll('.lang-switcher a').forEach(a => {
    if (a.dataset.lang === lang) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });

  // Apply font override if necessary (Thai/Lao need specific fonts)
  if (lang === 'th') {
    document.body.style.fontFamily = '"Noto Sans Thai", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  } else if (lang === 'lo') {
    document.body.style.fontFamily = '"Chanthavong", "Bouasavanh", "Phetsarath OT", "Saysettha OT", "Noto Sans Lao", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  } else {
    document.body.style.fontFamily = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // get lang from URL param or localStorage or default
  const urlParams = new URLSearchParams(window.location.search);
  const urlLang = urlParams.get('lang');
  
  const savedLang = localStorage.getItem('bnos_lang');
  const initialLang = urlLang || savedLang || DEFAULT_LANG;
  
  setLanguage(initialLang);

  // Theme toggle
  initTheme();

  // Setup click listeners for language switchers
  document.querySelectorAll('.lang-switcher a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const lang = a.dataset.lang;
      if (lang) {
        setLanguage(lang);
        const url = new URL(window.location);
        url.searchParams.set('lang', lang);
        window.history.pushState({}, '', url);
      }
    });
  });
});

window.setLanguage = setLanguage;
window.toggleTheme = toggleTheme;
