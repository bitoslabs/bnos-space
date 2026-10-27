/**
 * Recently published business pages on the configured relays.
 */
import { $, esc, setHidden } from "../shared/dom.js";
import { initials, profileName, timeAgo } from "../shared/format.js";
import { httpUrl, profilePageUrl } from "../shared/urls.js";
import { discoverRecent } from "../services/discovery.js";
import { t } from "../shared/i18n.js";

const CACHE_TTL = 5 * 60 * 1000;
const PAGE_SIZE = 9;

function hash(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function cacheKey(relays) {
  return `bnos.recent.v1.${hash(relays.join("|"))}`;
}

function readCache(relays) {
  try {
    const raw = sessionStorage.getItem(cacheKey(relays));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(relays, items, nextUntil) {
  try {
    sessionStorage.setItem(
      cacheKey(relays),
      JSON.stringify({ items, nextUntil, savedAt: Date.now() })
    );
  } catch {
    /* storage may be full or disabled */
  }
}

function clearCache(relays) {
  try {
    sessionStorage.removeItem(cacheKey(relays));
  } catch {
    /* ignore */
  }
}

export function createRecentView({ section, getRelays, getAuthPubkey }) {
  const grid = $("#recent-grid", section);
  const statusEl = $("#recent-status", section);
  const refreshBtn = $("#recent-refresh", section);
  const moreBtn = $("#recent-more", section);

  let items = [];
  let nextUntil = null;
  let started = false;
  let loading = false;
  let token = 0;
  let currentKey = "";

  function setStatus(message, { error = false } = {}) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(error));
  }

  function setBusy(busy) {
    loading = busy;
    if (refreshBtn) refreshBtn.disabled = busy;
    if (moreBtn) moreBtn.disabled = busy;
  }

  function renderSkeletons() {
    if (!grid) return;
    grid.hidden = false;
    grid.innerHTML = Array.from({ length: 3 })
      .map(
        () => `<div class="tile recent-card is-skeleton" aria-hidden="true">
          <div class="recent-skeleton-avatar"></div>
          <div class="recent-skeleton-line w70"></div>
          <div class="recent-skeleton-line w95"></div>
          <div class="recent-skeleton-line w50"></div>
        </div>`
      )
      .join("");
  }

  function renderCard(item) {
    const profile = item.profile || {};
    const avatar = httpUrl(profile.avatar);
    const name = profileName(profile);
    const headline = profile.headline || profile.bio || "";
    const skills = (profile.skills || []).slice(0, 3);
    const projectCount = (profile.projects || []).length;
    const galleryCount = (profile.gallery || []).length;
    const stats = [
      projectCount
        ? `${t("{count} cases", { count: projectCount })}`
        : "",
      galleryCount ? `${t("{count} media", { count: galleryCount })}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const own =
      getAuthPubkey && getAuthPubkey() === item.pubkey
        ? '<span class="recent-own">You</span>'
        : "";
    const typeChip =
      profile.type === "organization"
        ? '<span class="recent-type">Organization</span>'
        : "";

    return `<a class="tile recent-card" href="${profilePageUrl(
      item.npub
    )}" aria-label="${t("Open {name}'s business page", { name })}">
      <div class="recent-top">
        <span class="recent-avatar" aria-hidden="true">${
          avatar ? `<img src="${esc(avatar)}" alt="">` : esc(initials(name))
        }</span>
        <span class="recent-id">
          <span class="recent-name"><span class="recent-name-text">${esc(
            name
          )}</span>${own}${typeChip}</span>
          <span class="recent-updated">Updated ${esc(
            timeAgo(item.updatedAt)
          )}</span>
        </span>
        ${stats ? `<span class="recent-count">${stats}</span>` : ""}
      </div>
      ${
        headline
          ? `<p class="recent-headline">${esc(headline)}</p>`
          : ""
      }
      ${
        skills.length
          ? `<div class="recent-tags">${skills
              .map((skill) => `<span class="tag">${esc(skill.name)}</span>`)
              .join("")}</div>`
          : ""
      }
    </a>`;
  }

  function render() {
    if (!grid) return;
    if (!items.length) {
      grid.hidden = true;
      grid.innerHTML = "";
      if (moreBtn) moreBtn.hidden = true;
      return;
    }
    grid.hidden = false;
    grid.innerHTML = items.map(renderCard).join("");
    if (moreBtn) moreBtn.hidden = !nextUntil;
  }

  function failedHosts(errors) {
    const hosts = (errors || [])
      .map((error) => {
        try {
          return new URL(error.relay).host;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    return Array.from(new Set(hosts)).slice(0, 3).join(", ");
  }

  function showEmptyOrError(errors) {
    render();
    const totalRelays = getRelays().length;
    const allFailed = Boolean(
      errors && errors.length > 0 && errors.length >= totalRelays
    );
    const hosts = failedHosts(errors);
    const message = allFailed
      ? t("Discovery is unavailable on these relays.")
      : errors && errors.length
      ? hosts
        ? t("No public business pages found. No answer from {hosts}.", { hosts })
        : t("No public business pages found. Some relays did not answer.")
      : t("No public business pages found on these relays yet.");
    setStatus(message, { error: allFailed });
    if (errors && errors.length) {
      statusEl.innerHTML = `${esc(message)} <button class="head-link" type="button" data-action="relay-settings">${t("Change relays")}</button>`;
    }
  }

  async function load({ reset = false } = {}) {
    if (loading) return;
    const relays = getRelays();
    const key = cacheKey(relays);

    if (reset) {
      token += 1;
      items = [];
      nextUntil = null;
      currentKey = key;
      renderSkeletons();
      setStatus(t("Loading recent business pages…"));
    }

    const requestToken = token;
    setBusy(true);
    if (moreBtn) moreBtn.hidden = true;

    const until = reset ? null : nextUntil;
    let result;
    try {
      result = await discoverRecent(relays, {
        limit: PAGE_SIZE,
        until,
      });
    } catch {
      result = { items: [], errors: [{ error: "Discovery failed" }], nextUntil: null };
    }

    if (requestToken !== token || key !== cacheKey(getRelays())) return;

    setBusy(false);

    if (reset) {
      items = result.items;
    } else {
      const seen = new Set(items.map((item) => item.pubkey));
      result.items.forEach((item) => {
        if (!seen.has(item.pubkey)) {
          seen.add(item.pubkey);
          items.push(item);
        }
      });
    }
    const previousUntil = nextUntil;
    nextUntil = result.nextUntil;
    currentKey = key;

    if (!reset && !result.items.length && result.errors && result.errors.length) {
      nextUntil = previousUntil;
      render();
      setStatus(t("Some relays did not answer. Try again."), { error: true });
      return;
    }

    if (!items.length) {
      showEmptyOrError(result.errors);
      clearCache(relays);
      return;
    }

    render();
    writeCache(relays, items, nextUntil);
    const hosts = failedHosts(result.errors);
    const suffix =
      result.errors && result.errors.length
        ? hosts
          ? ` ${t("No answer from {hosts}.", { hosts })}`
          : " Some relays did not answer."
        : "";
    setStatus(
      `${t("{count} public business page(s) from your relays.", { count: items.length })}${suffix}`
    );
  }

  function start() {
    if (started) {
      render();
      return;
    }
    started = true;
    setHidden(section, false);
    const relays = getRelays();
    const cached = readCache(relays);

    if (cached) {
      items = cached.items;
      nextUntil = cached.nextUntil || null;
      currentKey = cacheKey(relays);
      render();
      setStatus(
        `${t("{count} public business page(s) from your relays.", { count: items.length })}`
      );
      if (Date.now() - (cached.savedAt || 0) < CACHE_TTL) return;
    } else {
      renderSkeletons();
      setStatus("Loading recent business pages…");
    }

    const schedule =
      window.requestIdleCallback ||
      ((fn) => window.setTimeout(fn, 350));
    schedule(() => load({ reset: true }));
  }

  function refresh() {
    if (!started || loading) return;
    clearCache(getRelays());
    items = [];
    nextUntil = null;
    load({ reset: true });
  }

  function setRelays() {
    const key = cacheKey(getRelays());
    if (!started || key === currentKey) return;
    token += 1;
    loading = false;
    setBusy(false);
    items = [];
    nextUntil = null;
    load({ reset: true });
  }

  function renderAuth() {
    if (started && items.length) render();
  }

  refreshBtn?.addEventListener("click", refresh);
  moreBtn?.addEventListener("click", () => load({ reset: false }));

  return { start, refresh, setRelays, renderAuth };
}
