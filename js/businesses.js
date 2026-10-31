/**
 * Public business directory for the marketing site.
 *
 * Businesses register a public page with a NIP-78 replaceable event:
 * kind 30078 with the `d` tag `bnos.space:business:v1` (see b/js/config.js).
 * Discovery, signature verification and profile normalization live in the
 * business-pages app (`b/js/services/discovery.js`); this module only loads
 * that data lazily and renders landing-style cards.
 */
import translations from './i18n.js';

const CACHE_TTL = 3 * 60 * 1000;
// v2: include bnos-svelte GLO shops; invalidates pre-GLO cached lists.
const CACHE_KEY = 'bnos.directory.v2';

function currentLang() {
  const lang = document.documentElement.lang;
  return translations[lang] ? lang : 'en';
}

function lookup(lang, key) {
  return key.split('.').reduce((obj, part) => (obj ? obj[part] : undefined), translations[lang]);
}

function interpolate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    vars && vars[key] != null ? String(vars[key]) : match,
  );
}

function t(key, vars) {
  const value = lookup(currentLang(), key);
  const fallback = value == null ? lookup('en', key) : value;
  return fallback == null ? key : interpolate(fallback, vars);
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeImage(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function businessName(profile) {
  return String(profile.name || profile.displayName || '').trim() || t('businesses.unnamed');
}

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '·';
  return parts
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toUpperCase();
}

function shortNpub(npub) {
  const value = String(npub || '');
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}

function relativeTime(seconds) {
  const then = Number(seconds);
  if (!Number.isFinite(then) || then <= 0) return '';
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - then));
  try {
    const formatter = new Intl.RelativeTimeFormat(currentLang(), { numeric: 'auto' });
    const units = [
      ['year', 31536000],
      ['month', 2592000],
      ['week', 604800],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
    ];
    for (const [unit, size] of units) {
      const value = Math.floor(diff / size);
      if (value >= 1) return formatter.format(-value, unit);
    }
    return formatter.format(0, 'second');
  } catch {
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
}

/** Static-host-safe link to the existing business page (detail view).
 * GLO org cards carry their org id so a key owning several companies links
 * to the right one. */
export function businessPageUrl(item) {
  const ref = item.npub || item.pubkey || '';
  const base = `b/?ref=${encodeURIComponent(ref)}`;
  if (item.source === 'glo' && item.orgId) {
    return `${base}&org=${encodeURIComponent(item.orgId)}`;
  }
  return base;
}

function renderCard(item) {
  const profile = item.profile || {};
  const name = businessName(profile);
  const avatar = safeImage(profile.avatar);
  const headline = String(profile.headline || profile.bio || '')
    .replace(/\s+/g, ' ')
    .trim();
  const handle = profile.nip05 || shortNpub(item.npub);
  const location = String(profile.location || '').trim();
  const updated = relativeTime(item.updatedAt);
  const typeLabel =
    profile.type === 'organization' ? t('businesses.business') : t('businesses.individual');
  const isNew = Boolean(item.updatedAt) && Date.now() / 1000 - item.updatedAt < 7 * 86400;
  const tags = (profile.skills || [])
    .map((skill) => String(skill && skill.name ? skill.name : '').trim())
    .filter(Boolean)
    .slice(0, 3);

  return `<a class="biz-card" href="${businessPageUrl(item)}" aria-label="${esc(
    t('businesses.viewPage'),
  )} — ${esc(name)}">
    <div class="biz-top">
      <span class="biz-avatar" aria-hidden="true">${
        avatar ? `<img src="${esc(avatar)}" alt="" loading="lazy" />` : esc(initials(name))
      }</span>
      <span class="biz-id">
        <span class="biz-name"><span class="biz-name-text">${esc(name)}</span>
          <span class="biz-type">${esc(typeLabel)}</span>
          ${isNew ? `<span class="biz-new">${esc(t('businesses.new'))}</span>` : ''}
        </span>
        <span class="biz-handle">${esc(handle)}</span>
      </span>
    </div>
    ${headline ? `<p class="biz-headline">${esc(headline)}</p>` : ''}
    ${
      tags.length
        ? `<div class="biz-tags">${tags
            .map((tag) => `<span class="biz-tag">${esc(tag)}</span>`)
            .join('')}</div>`
        : ''
    }
    <div class="biz-foot">
      <span class="biz-loc">${
        location
          ? `<iconify-icon icon="solar:map-point-linear" aria-hidden="true"></iconify-icon>${esc(location)}`
          : ''
      }</span>
      ${updated ? `<span class="biz-updated">${esc(t('businesses.updated', { time: updated }))}</span>` : ''}
    </div>
  </a>`;
}

function renderSkeletons(grid, count = 3) {
  grid.hidden = false;
  grid.innerHTML = Array.from({ length: count })
    .map(
      () => `<div class="biz-card is-skeleton" aria-hidden="true">
        <div class="biz-top">
          <span class="biz-skeleton biz-skeleton-avatar"></span>
          <span class="biz-skeleton-col">
            <span class="biz-skeleton biz-skeleton-line w60"></span>
            <span class="biz-skeleton biz-skeleton-line w40"></span>
          </span>
        </div>
        <span class="biz-skeleton biz-skeleton-line w95"></span>
        <span class="biz-skeleton biz-skeleton-line w75"></span>
      </div>`,
    )
    .join('');
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(items, nextUntil) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ items, nextUntil, savedAt: Date.now() }));
  } catch {
    /* storage may be full or disabled */
  }
}

async function discover({ limit, until }) {
  const [{ discoverRecent }, { DEFAULT_RELAYS }] = await Promise.all([
    import('../b/js/services/discovery.js'),
    import('../b/js/config.js'),
  ]);
  return discoverRecent(DEFAULT_RELAYS, { limit, until });
}

/**
 * Wire a directory grid.
 * @param {{
 *   grid: HTMLElement,
 *   status?: HTMLElement|null,
 *   moreBtn?: HTMLElement|null,
 *   retryBtn?: HTMLButtonElement|null,
 *   search?: HTMLInputElement|null,
 *   section?: HTMLElement|null,
 *   limit?: number,
 *   immediate?: boolean
 * }} options
 */
export function initBusinessDirectory({
  grid,
  status = null,
  moreBtn = null,
  retryBtn = null,
  search = null,
  section = null,
  limit = 6,
  immediate = false,
} = {}) {
  if (!grid) return null;

  let items = [];
  let nextUntil = null;
  let loading = false;
  let started = false;
  let token = 0;
  let query = '';
  let lastErrors = [];

  function setStatus(message, { error = false } = {}) {
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(error));
  }

  function setBusy(busy) {
    loading = busy;
    if (moreBtn) moreBtn.disabled = busy;
    if (retryBtn) retryBtn.disabled = busy;
    grid.classList.toggle('is-busy', busy);
    grid.setAttribute('aria-busy', String(busy));
  }

  function filtered() {
    if (!query) return items;
    const needle = query.toLowerCase();
    return items.filter((item) => {
      const profile = item.profile || {};
      const haystack = [
        profile.name,
        profile.displayName,
        profile.headline,
        profile.bio,
        profile.location,
        profile.nip05,
        ...(profile.skills || []).map((skill) => skill && skill.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  function countMessage() {
    const base = t('businesses.count', { count: items.length });
    return `${base} ${t('businesses.relayNote')}`;
  }

  function render() {
    const list = filtered();
    if (!list.length) {
      grid.hidden = true;
      grid.innerHTML = '';
      if (moreBtn) moreBtn.hidden = true;
      return;
    }
    grid.hidden = false;
    grid.innerHTML = list.map(renderCard).join('');
    if (moreBtn) moreBtn.hidden = !nextUntil || Boolean(query);
  }

  function updateStatus(errors = lastErrors) {
    const list = filtered();
    if (loading) {
      setStatus(t('businesses.loading'));
      return;
    }
    if (retryBtn) retryBtn.hidden = Boolean(items.length) && !errors.length;
    if (!items.length) {
      setStatus(
        errors && errors.length ? t('businesses.error') : t('businesses.empty'),
        { error: Boolean(errors && errors.length) },
      );
      return;
    }
    if (!list.length) {
      setStatus(t('businesses.noResults'));
      return;
    }
    const partial = errors && errors.length ? ` ${t('businesses.partial')}` : '';
    setStatus(`${countMessage()}${partial}`);
  }

  async function load({ reset = false } = {}) {
    if (loading) return;
    const requestToken = ++token;
    setBusy(true);
    if (moreBtn) moreBtn.hidden = true;
    setStatus(t('businesses.loading'));
    if (reset && !items.length) renderSkeletons(grid);

    let result;
    try {
      result = await discover({ limit, until: reset ? null : nextUntil });
    } catch {
      result = { items: [], errors: [{ error: 'Discovery failed' }], nextUntil: null };
    }

    if (requestToken !== token) return;
    setBusy(false);

    lastErrors = result.errors || [];
    const failed = !result.items.length && lastErrors.length > 0;
    if (reset) {
      // Keep useful cached results visible when a refresh cannot reach relays.
      if (!failed) {
        items = result.items;
        nextUntil = result.nextUntil;
      }
    } else {
      // One presence page per key, but every GLO organization is its own item.
      const seen = new Set(items.map((item) => (item.orgId ? `glo:${item.orgId}` : item.pubkey)));
      for (const item of result.items) {
        const key = item.orgId ? `glo:${item.orgId}` : item.pubkey;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
      if (!failed) nextUntil = result.nextUntil;
      // Keep the directory strictly newest-registered-first across pages.
      items.sort(
        (a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0),
      );
    }

    render();
    updateStatus();
    if (items.length && !lastErrors.length) writeCache(items, nextUntil);
  }

  function start() {
    if (started) return;
    started = true;

    const cached = readCache();
    if (cached && cached.items.length) {
      items = cached.items;
      nextUntil = cached.nextUntil || null;
      render();
      setStatus(countMessage());
      if (Date.now() - (cached.savedAt || 0) < CACHE_TTL) return;
    } else {
      renderSkeletons(grid);
      setStatus(t('businesses.loading'));
    }

    const schedule = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 250));
    schedule(() => load({ reset: true }));
  }

  if (search) {
    search.addEventListener('input', () => {
      query = search.value.trim();
      render();
      updateStatus();
    });
  }

  if (moreBtn) {
    moreBtn.addEventListener('click', () => load({ reset: false }));
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', () => load({ reset: true }));
  }

  document.addEventListener('bnos:lang', () => {
    if (!started) return;
    if (!loading) render();
    updateStatus();
  });

  if (immediate) {
    start();
  } else if (section && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.disconnect();
          start();
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' },
    );
    observer.observe(section);
  } else {
    start();
  }

  return { start, refresh: () => load({ reset: true }) };
}
