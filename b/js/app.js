/**
 * Composition root. Wires views, services and the URL together.
 */
import { SITE_ORIGIN } from "./config.js";
import { $, $$, esc, setHidden } from "./shared/dom.js";
import { hexToNpub } from "./shared/bech32.js";
import { profileName, shortKey } from "./shared/format.js";
import { contactUrl, profilePageUrl } from "./shared/urls.js";
import { copyToClipboard } from "./shared/clipboard.js";
import { fetchJson } from "./shared/fetch.js";
import { cleanRef, refFromPath, resolveRef } from "./nostr/identity.js";
import { loadRelays } from "./data/storage.js";
import { normalizeProfile } from "./data/profile-model.js";
import * as auth from "./services/auth.js";
import * as profileService from "./services/profile.js";
import { fetchMyPortfolio } from "./services/my-portfolio.js";
import {
  applyPortfolioTheme,
  initTheme,
  resetPortfolioTheme,
} from "./ui/theme.js";
import { createToast } from "./ui/toast.js";
import { renderLandingSession } from "./ui/landing-view.js";
import { renderState } from "./ui/state-view.js";
import {
  publicGallery,
  renderProfile as renderProfileView,
  updateNip05Badges,
} from "./ui/profile-view.js";
import { createAuthDialog } from "./ui/auth-dialog.js";
import { renderQr } from "./ui/qr.js";
import { createEditorView } from "./ui/editor-view.js?v=13";
import { createRecentView } from "./ui/recent-view.js";
import { createLightbox } from "./ui/lightbox.js";
import { createConfirmDialog } from "./ui/confirm-dialog.js";
import {
  applyTranslations,
  getLang,
  initLang,
  setLang,
  t,
} from "./shared/i18n.js";

const state = {
  ref: "",
  orgId: "",
  profile: null,
  profilePubkey: "",
  updatedAt: 0,
  meta: null,
  demo: false,
  nip05Status: "none",
  nip05FromRef: "",
  nip05Checked: "",
  emptyReason: "",
  relays: loadRelays(),
  loadToken: 0,
  editRequested: false,
  authReady: false,
  myProfile: {
    status: "idle",
    pubkey: null,
    profile: null,
    updatedAt: 0,
  },
};

let els = {};
let toast = () => {};
let authDialog = null;
let editor = null;
let recentView = null;
let lightbox = null;
let confirmModal = null;
let myProfileToken = 0;

/* ---------------- views ---------------- */

function setView(view) {
  els.main.hidden = false;
  setHidden(els.landing, view !== "landing");
  setHidden(els.stateView, view !== "state");
  setHidden(els.profile, view !== "profile");
  setHidden(els.editorView, view !== "editor");
  const isProfile = view === "profile";
  const isLanding = view === "landing";
  setHidden(els.profileNav, !isProfile);
  if (els.landingNav) setHidden(els.landingNav, !isLanding);
  if (els.navToggle) {
    setHidden(els.navToggle, !isProfile && !isLanding);
    els.navToggle.setAttribute(
      "aria-controls",
      isProfile ? "profile-nav" : isLanding ? "landing-nav" : ""
    );
  }
  closeNavMenu();
  setHidden(els.shareBtn, view !== "profile");
  if (els.myPortfolioLink) {
    setHidden(
      els.myPortfolioLink,
      view === "editor" || !auth.getState().pubkey
    );
  }
  queueProfileNavSync();
}

function renderSession() {
  renderLandingSession(els.landingSession, auth.getState(), state.myProfile);
}

function navMenus() {
  return [els.profileNav, els.landingNav].filter(Boolean);
}

function activeNavMenu() {
  return navMenus().find((nav) => !nav.hidden) || null;
}

function navMenuLabel(nav) {
  return nav === els.profileNav
    ? t("business page sections")
    : t("navigation");
}

function navToggleLabel(open, nav) {
  return t(open ? "Close {target}" : "Open {target}", {
    target: navMenuLabel(nav),
  });
}

let profileNavFrame = 0;

function syncProfileNavActive() {
  profileNavFrame = 0;
  if (
    !els.profileNav ||
    els.profileNav.hidden ||
    !els.profile ||
    els.profile.hidden
  ) {
    return;
  }
  const links = Array.from(
    els.profileNav.querySelectorAll('a[href^="#"]')
  );
  const sections = Array.from(
    els.profile.querySelectorAll(".section[id]")
  );
  if (!links.length || !sections.length) return;

  const anchor = window.scrollY + 140;
  let current = sections[0].id;
  sections.forEach((section) => {
    if (section.getBoundingClientRect().top + window.scrollY <= anchor) {
      current = section.id;
    }
  });
  if (
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - 40
  ) {
    current = sections[sections.length - 1].id;
  }

  links.forEach((link) => {
    const active =
      !link.hidden && link.getAttribute("href") === `#${current}`;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}

function queueProfileNavSync() {
  if (profileNavFrame) return;
  profileNavFrame = window.requestAnimationFrame(syncProfileNavActive);
}

function closeNavMenu(focusToggle = false) {
  const navs = navMenus();
  const open = navs.find((nav) => nav.classList.contains("is-open"));
  navs.forEach((nav) => nav.classList.remove("is-open"));
  if (els.navToggle) {
    els.navToggle.setAttribute("aria-expanded", "false");
    els.navToggle.setAttribute(
      "aria-label",
      navToggleLabel(false, activeNavMenu())
    );
    if (open && focusToggle) els.navToggle.focus();
  }
}

function setNavMenu(open, focusFirst = false) {
  const nav = activeNavMenu();
  const canOpen =
    Boolean(nav) && window.matchMedia("(max-width: 760px)").matches;
  closeNavMenu();
  if (!canOpen || !open || !els.navToggle || !nav) return;
  nav.classList.add("is-open");
  els.navToggle.setAttribute("aria-expanded", "true");
  els.navToggle.setAttribute("aria-label", navToggleLabel(true, nav));
  if (focusFirst) {
    const first = Array.from(nav.querySelectorAll("a")).find(
      (link) => !link.hidden
    );
    if (first) first.focus();
  }
}

function setChipRef(ref) {
  els.urlChipPath.textContent = ref ? `/b/${ref}` : "/b/";
  els.urlChip.title = ref ? profileService.canonicalUrl(ref) : t("Canonical public URL");
}

function setCanonicalDisplay(
  ref,
  { title = "", description = "", url = "", display = "" } = {}
) {
  const canonical = url || profileService.canonicalUrl(ref);
  if (display) {
    els.urlChipPath.textContent = display;
    els.urlChip.title = canonical;
  } else {
    setChipRef(ref);
  }
  const span = els.footerUrl.querySelector("span");
  if (span) {
    span.textContent = display
      ? `bnos.space${display}`
      : profileService.displayUrl(ref);
  }
  els.footerUrl.title = canonical;
  const link = $("#canonical-link");
  if (link) link.setAttribute("href", canonical);
  const ogTitle = $("#og-title");
  if (ogTitle && title) ogTitle.setAttribute("content", title);
  const ogDescription = $("#og-description");
  if (ogDescription && description) {
    ogDescription.setAttribute("content", description.slice(0, 160));
  }
  document.title = title || t("Business presence — bnos.space");
}

function showLanding() {
  state.demo = false;
  state.ref = "";
  resetPortfolioTheme();
  setView("landing");
  setHidden(els.demoBanner, true);
  syncMyPortfolio();
  renderSession();
  if (recentView) recentView.start();
  setChipRef("");
  const span = els.footerUrl.querySelector("span");
  if (span) span.textContent = "bnos.space/b/";
  const link = $("#canonical-link");
  if (link) link.setAttribute("href", profileService.canonicalUrl(""));
  document.title = t("Business presence on Nostr — bnos.space");
  maybeOpenRequestedEditor();
}

function showLoading(title, text) {
  resetPortfolioTheme();
  setView("state");
  setHidden(els.demoBanner, !state.demo);
  renderState(els.stateView, { mode: "loading", title, text });
  setChipRef(state.ref);
  document.title = t("Business presence — bnos.space");
}

function showRelayError() {
  resetPortfolioTheme();
  setView("state");
  setHidden(els.demoBanner, !state.demo);
  renderState(els.stateView, {
    mode: "error",
    title: t("Relays are unavailable"),
    text: t("The relays configured in this browser did not answer. Check your connection or change the relay list, then retry."),
    actions: `<button class="btn btn-primary" type="button" data-action="retry">Retry</button>
      <button class="btn btn-ghost" type="button" data-action="relay-settings">Relay settings</button>`,
  });
  setChipRef(state.ref);
  document.title = t("Relays unavailable — bnos.space");
}

function showResolveError(message) {
  resetPortfolioTheme();
  setView("state");
  setHidden(els.demoBanner, true);
  renderState(els.stateView, {
    mode: "error",
    title: t("Business not found"),
    text: esc(message || t("That reference could not be resolved.")),
    actions: `<button class="btn btn-primary" type="button" data-action="retry">Retry</button>
      <button class="btn btn-ghost" type="button" data-action="signin">Sign in to manage</button>
      <a class="btn btn-ghost" href="./">${t("Try another business page")}</a>`,
  });
  setChipRef(state.ref);
  document.title = t("Business page not found — bnos.space");
}

function renderProfile({ skipView = false } = {}) {
  if (!state.profile || !state.profilePubkey) return;
  if (!skipView) setView("profile");
  setHidden(els.demoBanner, !state.demo);

  const npub = hexToNpub(state.profilePubkey);
  applyPortfolioTheme(state.profile.theme);
  renderProfileView(els.profile, {
    profile: state.profile,
    pubkey: state.profilePubkey,
    npub,
    updatedAt: state.updatedAt,
    isOwner: auth.isOwnerOf(state.profilePubkey),
    isDemo: state.demo,
  });
  setHidden(els.navGallery, publicGallery(state.profile).length === 0);
  queueProfileNavSync();

  updateCanonical();
  if (editor && editor.isOpen()) {
    document.title = t("Edit business page — bnos.space");
  }
  updateAuthUI();
  updateNip05Badges(els.profile, normalizeStatus(state.nip05Status));
  verifyNip05();
  if (auth.isOwnerOf(state.profilePubkey)) syncMyPortfolio();
  maybeOpenRequestedEditor();
}

function updateCanonical() {
  const title = t("{name} — Business presence — bnos.space", {
    name: profileName(state.profile),
  });
  const description = state.profile.headline || state.profile.bio || "";
  if (state.demo) {
    setCanonicalDisplay("", {
      title,
      description,
      url: shareUrl(),
      display: "/b/?demo=1",
    });
    return;
  }
  const ref = profileService.canonicalRef(
    state.profile,
    state.profilePubkey,
    state.nip05Status
  );
  setCanonicalDisplay(ref, { title, description });
}

function renderEmpty() {
  resetPortfolioTheme();
  const npub = hexToNpub(state.profilePubkey);
  const knownName = state.meta ? profileName(state.meta) : "";
  const title = knownName
    ? t("{name} hasn't published a business page yet", { name: knownName })
    : t("No business page published for this key");
  const owner = auth.isOwnerOf(state.profilePubkey);
  let actions = "";
  if (owner) {
    actions += `<button class="btn btn-primary" type="button" data-action="create">${t("Create your business page")}</button>`;
  } else if (auth.getState().pubkey) {
    actions += `<button class="btn btn-primary" type="button" data-action="signin">${t("Switch signer")}</button>`;
  } else {
    actions += `<button class="btn btn-primary" type="button" data-action="signin">${t("Sign in as the owner")}</button>`;
  }
  actions += `<button class="btn btn-ghost" type="button" data-action="copy" data-copy="${esc(
    npub
  )}">${t("Copy npub")}</button>`;

  const keyLine = `<div class="key-line">
    <span class="npub-chip"><code>${esc(shortKey(npub))}</code></span>
    ${
      state.nip05FromRef
        ? `<span class="npub-chip"><code>${esc(state.nip05FromRef)}</code></span>`
        : ""
    }
  </div>`;

  setView("state");
  setHidden(els.demoBanner, !state.demo);
  renderState(els.stateView, {
    mode: "empty",
    title,
    text: `${t("The key resolves, but no signed business page was found on the configured relays. Only the key holder can publish one.")}${keyLine}`,
    actions,
  });
  setCanonicalDisplay(npub, {
    title: `${title} — bnos.space`,
    description: "This Nostr key has not published a business page yet.",
  });
  maybeOpenRequestedEditor();
}

function updateAuthUI() {
  const authState = auth.getState();
  if (!authState.pubkey) {
    els.authBtn.textContent = t("Sign in");
    els.authBtn.setAttribute("aria-label", t("Sign in to manage your business page"));
  } else {
    els.authBtn.textContent = t("Account");
    els.authBtn.setAttribute("aria-label", t("Manage your Nostr signer"));
  }
  if (els.landingSigninLabel) {
    els.landingSigninLabel.textContent = authState.pubkey
      ? "Manage signer"
      : "Sign in to manage";
  }
  if (els.myPortfolioLink) {
    if (authState.pubkey) {
      els.myPortfolioLink.href = profilePageUrl(
        hexToNpub(authState.pubkey)
      );
    }
    const inEditor = els.editorView && !els.editorView.hidden;
    setHidden(els.myPortfolioLink, !authState.pubkey || inEditor);
  }
}

/* ---------------- NIP-05 ---------------- */

function normalizeStatus(status) {
  return status === "invalid" ? "unverified" : status;
}

async function verifyNip05() {
  if (!state.profile) return;
  const identifier = (state.profile.nip05 || "").trim();
  if (!identifier || state.demo) {
    state.nip05Status = "none";
    updateNip05Badges(els.profile, "none");
    updateCanonical();
    return;
  }
  const checkKey = `${state.profilePubkey}|${identifier.toLowerCase()}`;
  if (state.nip05Checked === checkKey) return;
  state.nip05Checked = checkKey;

  if (
    state.nip05FromRef &&
    state.nip05FromRef.toLowerCase() === identifier.toLowerCase()
  ) {
    state.nip05Status = "verified";
    updateNip05Badges(els.profile, "verified");
    updateCanonical();
    return;
  }

  state.nip05Status = "pending";
  updateNip05Badges(els.profile, "pending");
  updateCanonical();

  const result = await profileService.checkNip05(
    state.profile,
    state.profilePubkey,
    state.nip05FromRef
  );
  if (checkKey !== state.nip05Checked) return;
  state.nip05Status = normalizeStatus(result.status);
  updateNip05Badges(els.profile, state.nip05Status);
  updateCanonical();
}

/* ---------------- data loading ---------------- */

async function route() {
  const params = new URLSearchParams(location.search);
  state.editRequested = params.get("edit") === "1";
  // `org` selects one specific GLO organization when a key owns several.
  state.orgId = params.get("org") || "";
  if (params.get("demo") === "1") {
    state.editRequested = false;
    await loadDemo();
    return;
  }
  const ref = cleanRef(params.get("ref") || refFromPath() || "");
  state.demo = false;
  if (!ref) {
    showLanding();
    maybeOpenRequestedEditor();
    return;
  }
  await loadByRef(ref);
}

async function loadByRef(rawRef) {
  const token = ++state.loadToken;
  state.ref = cleanRef(rawRef);
  state.profile = null;
  state.profilePubkey = "";
  state.updatedAt = 0;
  state.meta = null;
  state.demo = false;
  state.nip05Status = "none";
  state.nip05FromRef = "";
  state.nip05Checked = "";
  state.emptyReason = "";

  showLoading(
    t("Resolving business page…"),
    `Looking up <span class="mono">${esc(state.ref)}</span>.`
  );

  let resolved;
  try {
    resolved = await resolveRef(state.ref);
  } catch (error) {
    if (token !== state.loadToken) return;
    showResolveError((error && error.message) || "That reference could not be resolved.");
    return;
  }
  if (token !== state.loadToken) return;

  state.profilePubkey = resolved.pubkey;
  state.nip05FromRef = resolved.nip05 || "";
  const cached = profileService.loadCachedProfile(resolved.pubkey);

  if (cached) {
    state.profile = cached.profile;
    state.updatedAt = cached.createdAt;
    state.nip05Status =
      state.profile.nip05 &&
      state.nip05FromRef &&
      state.profile.nip05.toLowerCase() === state.nip05FromRef.toLowerCase()
        ? "verified"
        : "pending";
    renderProfile();
  } else {
    showLoading(
      t("Loading from relays…"),
      `Asking ${state.relays.length} relay${
        state.relays.length === 1 ? "" : "s"
      } for the newest signed business event for <span class="mono">${esc(
        shortKey(hexToNpub(resolved.pubkey))
      )}</span>.`
    );
  }

  const result = await profileService.loadProfileFromRelays(
    resolved.pubkey,
    state.relays,
    { orgId: state.orgId || "" }
  );
  if (token !== state.loadToken) return;

  if (result.profile && (!cached || result.createdAt >= cached.createdAt)) {
    state.profile = result.profile;
    state.updatedAt = result.createdAt;
    state.nip05Status =
      state.profile.nip05 &&
      state.nip05FromRef &&
      state.profile.nip05.toLowerCase() === state.nip05FromRef.toLowerCase()
        ? "verified"
        : "pending";
    profileService.saveProfileCache(
      resolved.pubkey,
      state.profile,
      state.updatedAt
    );
    renderProfile();
    return;
  }

  if (state.profile) {
    verifyNip05();
    return;
  }

  if (result.meta) state.meta = result.meta;
  if (result.allFailed) {
    showRelayError();
    return;
  }
  state.emptyReason = "not-published";
  renderEmpty();
}

async function loadDemo() {
  const token = ++state.loadToken;
  state.demo = true;
  state.ref = "";
  state.profile = null;
  state.profilePubkey = "";
  state.updatedAt = 0;
  state.meta = null;
  state.emptyReason = "";
  state.nip05Status = "none";
  state.nip05FromRef = "";
  state.nip05Checked = "";

  showLoading(t("Loading sample business page…"), t("Illustrative data only."));
  try {
    const data = await fetchJson("./data/demo.json", 5000);
    if (!data || !data.profile || !/^[0-9a-f]{64}$/i.test(data.pubkey)) {
      throw new Error("Sample data is malformed.");
    }
    if (token !== state.loadToken) return;
    state.profilePubkey = data.pubkey.toLowerCase();
    state.profile = normalizeProfile(data.profile);
    state.updatedAt = Number(data.created_at) || 0;
    state.emptyReason = "";
    renderProfile();
  } catch (error) {
    if (token !== state.loadToken) return;
    setView("state");
    setHidden(els.demoBanner, false);
    renderState(els.stateView, {
      mode: "error",
      title: t("Sample unavailable"),
      text: esc((error && error.message) || t("Could not load the sample business page.")),
      actions: `<a class="btn btn-primary" href="./">Open a profile</a>`,
    });
    setChipRef("");
    document.title = t("Sample unavailable — bnos.space");
  }
}

/* ---------------- auth / editor ---------------- */

function updateMyPortfolioUI() {
  if (authDialog) authDialog.render();
  renderSession();
  updateAuthUI();
}

function syncMyPortfolio(force = false) {
  const authState = auth.getState();
  if (!authState.pubkey) {
    myProfileToken += 1;
    state.myProfile = {
      status: "idle",
      pubkey: null,
      profile: null,
      updatedAt: 0,
    };
    updateMyPortfolioUI();
    return;
  }

  const pubkey = authState.pubkey;
  if (state.profile && state.profilePubkey === pubkey) {
    state.myProfile = {
      status: "published",
      pubkey,
      profile: state.profile,
      updatedAt: state.updatedAt,
    };
    updateMyPortfolioUI();
    return;
  }

  if (
    !force &&
    state.myProfile.pubkey === pubkey &&
    ["loading", "published", "empty", "error"].includes(
      state.myProfile.status
    )
  ) {
    return;
  }

  loadMyPortfolio(pubkey);
}

async function loadMyPortfolio(pubkey) {
  const token = ++myProfileToken;
  const cached = profileService.loadCachedProfile(pubkey);
  const knownStatus =
    state.myProfile.pubkey === pubkey ? state.myProfile.status : "";

  if (cached) {
    state.myProfile = {
      status: "published",
      pubkey,
      profile: cached.profile,
      updatedAt: cached.createdAt,
    };
  } else if (!["published", "empty", "error"].includes(knownStatus)) {
    state.myProfile = {
      status: "loading",
      pubkey,
      profile: null,
      updatedAt: 0,
    };
  }
  updateMyPortfolioUI();

  let result;
  try {
    result = await fetchMyPortfolio(pubkey, state.relays);
  } catch {
    result = { status: "error" };
  }

  if (token !== myProfileToken || auth.getState().pubkey !== pubkey) return;

  if (result.status === "published") {
    state.myProfile = {
      status: "published",
      pubkey,
      profile: result.profile,
      updatedAt: result.updatedAt || 0,
    };
  } else if (result.status === "empty" && state.myProfile.status !== "published") {
    state.myProfile = {
      status: "empty",
      pubkey,
      profile: result.profile || null,
      updatedAt: 0,
    };
  } else if (
    result.status === "error" &&
    !["published", "empty"].includes(state.myProfile.status)
  ) {
    state.myProfile = {
      status: "error",
      pubkey,
      profile: null,
      updatedAt: 0,
    };
  }

  updateMyPortfolioUI();
}

function openAccount(options) {
  if (auth.getState().pubkey) {
    const status = state.myProfile.status;
    syncMyPortfolio(status === "empty" || status === "error" || status === "idle");
  }
  authDialog.open(options);
}

function handleAuthChange() {
  if (authDialog) authDialog.render();
  updateAuthUI();
  const authState = auth.getState();

  if (editor && editor.isOpen()) {
    if (!authState.pubkey || (state.profilePubkey && !auth.isOwnerOf(state.profilePubkey))) {
      editor.close();
    } else if (state.profile) {
      renderProfile({ skipView: true });
    }
  } else if (state.profile && !els.profile.hidden) {
    renderProfile();
  } else if (!els.stateView.hidden && state.emptyReason === "not-published") {
    renderEmpty();
  }

  syncMyPortfolio();
  renderSession();
  if (recentView) recentView.renderAuth();
  maybeOpenRequestedEditor();
}

function openEditor({ tab = "profile" } = {}) {
  if (state.demo) {
    toast(t("Sample data is read-only. Sign in to create your own business page."), true);
    return;
  }
  const authState = auth.getState();
  if (!authState.pubkey) {
    openAccount();
    return;
  }
  const target = state.profilePubkey || authState.pubkey;
  if (target !== authState.pubkey) {
    toast(
      "This page belongs to a different key. Sign in with the owner key to edit it.",
      true
    );
    return;
  }
  if (!state.profile) state.profilePubkey = authState.pubkey;
  editor.open(state.profile, authState.pubkey, {
    updatedAt: state.updatedAt,
    tab,
  });
  setView("editor");
  document.title = "Edit business page — bnos.space";
  setEditParam(true);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function handlePublished(result) {
  const pubkey = auth.getState().pubkey;
  if (!pubkey) return;
  state.profile = normalizeProfile(result.publicProfile);
  state.profilePubkey = pubkey;
  state.updatedAt = result.signed.created_at || Math.floor(Date.now() / 1000);
  state.demo = false;
  state.nip05Status = "pending";
  state.nip05Checked = "";
  profileService.saveProfileCache(pubkey, state.profile, state.updatedAt);
  renderProfile({ skipView: editor && editor.isOpen() });
  updateAuthUI();
  if (recentView) recentView.refresh();

  if (!state.ref) {
    const npub = hexToNpub(pubkey);
    const url = new URL(location.href);
    url.searchParams.set("ref", npub);
    url.searchParams.delete("demo");
    history.replaceState(null, "", url.toString());
    state.ref = npub;
  }
}

function handleEditorClosed() {
  if (confirmModal) confirmModal.close();
  clearEditParam();
  if (state.profile) {
    setView("profile");
    renderProfile({ skipView: true });
  } else if (state.ref && state.profilePubkey) {
    renderEmpty();
  } else {
    state.profilePubkey = "";
    updateAuthUI();
    showLanding();
  }
  renderSession();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function setEditParam(enabled) {
  const url = new URL(location.href);
  if (enabled) url.searchParams.set("edit", "1");
  else url.searchParams.delete("edit");
  history.replaceState(null, "", url.toString());
}

function clearEditParam() {
  state.editRequested = false;
  setEditParam(false);
}

function maybeOpenRequestedEditor() {
  if (!state.editRequested || !state.authReady) return;
  const authState = auth.getState();
  if (!authState.pubkey) {
    if (!els.signinDialog.open) openAccount();
    return;
  }
  if (state.profilePubkey && !auth.isOwnerOf(state.profilePubkey)) {
    state.editRequested = false;
    setEditParam(false);
    toast(
      "This business page belongs to a different key. Sign in with the owner key to edit it.",
      true
    );
    return;
  }
  if (state.ref && !state.profile && state.emptyReason !== "not-published") {
    return;
  }
  if (!state.ref && !state.profilePubkey) {
    state.editRequested = false;
    openEditor();
    return;
  }
  if (!state.profilePubkey) return;
  state.editRequested = false;
  openEditor();
}

/* ---------------- actions ---------------- */

function currentCanonicalRef() {
  if (state.profile) {
    return profileService.canonicalRef(
      state.profile,
      state.profilePubkey,
      state.nip05Status
    );
  }
  return state.profilePubkey ? hexToNpub(state.profilePubkey) : state.ref;
}

function shareUrl() {
  if (state.demo) return `${SITE_ORIGIN}/b/?demo=1`;
  return `${SITE_ORIGIN}${profilePageUrl(currentCanonicalRef())}`;
}

async function shareProfile() {
  const url = shareUrl();
  const title = state.profile
    ? t("{name} — Business presence", { name: profileName(state.profile) })
    : t("Nostr business presence");
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  const ok = await copyToClipboard(url);
  toast(ok ? t("Link copied.") : t("Could not copy the link."), !ok);
}

async function copyAction(target, text) {
  const ok = await copyToClipboard(text);
  if (ok) {
    target.classList.add("done");
    window.setTimeout(() => target.classList.remove("done"), 1400);
  }
  toast(ok ? t("Copied.") : t("Could not copy."), !ok);
}

function openQr() {
  const url = shareUrl();
  els.profileQrUrl.textContent = url;
  if (!renderQr(els.profileQr, url)) {
    toast(t("QR rendering is unavailable. Copy the link instead."), true);
  }
  if (typeof els.qrDialog.showModal === "function") {
    if (!els.qrDialog.open) els.qrDialog.showModal();
  } else {
    els.qrDialog.setAttribute("open", "");
  }
}

async function onActionClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.getAttribute("data-action");
  if (action === "share") {
    shareProfile();
  } else if (action === "copy") {
    copyAction(target, target.getAttribute("data-copy") || "");
  } else if (action === "copy-link") {
    copyAction(target, shareUrl());
  } else if (action === "share-qr") {
    openQr();
  } else if (action === "gallery-open") {
    const index = Number(target.getAttribute("data-index"));
    if (lightbox && state.profile) {
      lightbox.open(publicGallery(state.profile), Number.isFinite(index) ? index : 0);
    }
  } else if (action === "edit" || action === "create") {
    openEditor();
  } else if (action === "edit-media") {
    openEditor({ tab: "gallery" });
  } else if (action === "contact") {
    const url = contactUrl(target.getAttribute("data-url") || "");
    if (url) location.href = url;
    else toast(t("No contact link is configured."), true);
  } else if (action === "signin") {
    openAccount();
  } else if (action === "relay-settings") {
    openAccount({ showRelays: true });
  } else if (action === "retry") {
    route();
  }
}

/* ---------------- events / boot ---------------- */

function cacheElements() {
  els = {
    main: $("#main"),
    landing: $("#landing-view"),
    stateView: $("#state-view"),
    profile: $("#profile-view"),
    demoBanner: $("#demo-banner"),
    urlChip: $("#url-chip"),
    urlChipPath: $("#url-chip-path"),
    profileNav: $("#profile-nav"),
    landingNav: $("#landing-nav"),
    navToggle: $("#nav-toggle"),
    navGallery: $("#nav-gallery"),
    shareBtn: $("#share-btn"),
    authBtn: $("#auth-btn"),
    myPortfolioLink: $("#my-portfolio-link"),
    themeBtn: $("#theme-btn"),
    landingSession: $("#landing-session"),
    lookupForm: $("#lookup-form"),
    lookupInput: $("#lookup-input"),
    landingSignin: $("#landing-signin"),
    landingSigninLabel: $("#landing-signin-label"),
    footerUrl: $("#footer-url"),
    signinDialog: $("#signin-dialog"),
    editorView: $("#editor-view"),
    qrDialog: $("#qr-dialog"),
    profileQr: $("#profile-qr"),
    profileQrUrl: $("#profile-qr-url"),
    copyProfileQr: $("#copy-profile-qr"),
    confirmDialog: $("#confirm-dialog"),
    confirmKicker: $("#confirm-kicker"),
    confirmTitle: $("#confirm-title"),
    confirmMessage: $("#confirm-message"),
    confirmAccept: $("#confirm-accept"),
    confirmCancel: $("#confirm-cancel"),
    lightboxDialog: $("#lightbox-dialog"),
    lightboxStage: $("#lightbox-stage"),
    lightboxTitle: $("#lightbox-title"),
    lightboxCount: $("#lightbox-count"),
    lightboxCaption: $("#lightbox-caption"),
    lightboxPrev: $("#lightbox-prev"),
    lightboxNext: $("#lightbox-next"),
    toast: $("#toast"),
  };
}

function bindEvents() {
  els.lookupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = cleanRef(els.lookupInput.value);
    if (!value) {
      toast(t("Enter an npub, NIP-05 address, or alias."), true);
      return;
    }
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("ref", value);
    location.assign(url.toString());
  });

  els.landingSignin.addEventListener("click", () => openAccount());
  if (els.navToggle) {
    els.navToggle.addEventListener("click", (event) => {
      const active = activeNavMenu();
      const open = Boolean(
        active && active.classList.contains("is-open")
      );
      setNavMenu(!open, event.detail === 0);
    });
  }
  navMenus().forEach((nav) => {
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeNavMenu();
    });
  });
  if (els.profileNav) {
    els.profileNav.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || !els.profile) return;
      const id = link.getAttribute("href").slice(1);
      const section = els.profile.querySelector(`#${id}`);
      if (!section) return;
      event.preventDefault();
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      section.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
      queueProfileNavSync();
    });
  }
  window.addEventListener("scroll", queueProfileNavSync, { passive: true });
  window.addEventListener("resize", queueProfileNavSync, { passive: true });
  document.addEventListener("click", (event) => {
    const open = navMenus().some((nav) => nav.classList.contains("is-open"));
    if (!open) return;
    if (
      event.target.closest("#profile-nav") ||
      event.target.closest("#landing-nav") ||
      event.target.closest("#nav-toggle")
    ) {
      return;
    }
    closeNavMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (navMenus().some((nav) => nav.classList.contains("is-open"))) {
      closeNavMenu(true);
    }
  });
  try {
    const mobileNav = window.matchMedia("(max-width: 760px)");
    mobileNav.addEventListener("change", (event) => {
      if (!event.matches) closeNavMenu();
    });
  } catch {
    /* matchMedia unavailable */
  }
  els.shareBtn.addEventListener("click", shareProfile);
  els.copyProfileQr.addEventListener("click", () => {
    copyAction(els.copyProfileQr, els.profileQrUrl.textContent);
  });
  els.authBtn.addEventListener("click", () => openAccount());

  document.addEventListener("click", onActionClick);
  $$("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = document.getElementById(button.getAttribute("data-close"));
      if (!dialog) return;
      if (dialog.open) dialog.close();
      else dialog.removeAttribute("open");
    });
  });
  [els.signinDialog, els.qrDialog, els.lightboxDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function init() {
  cacheElements();
  toast = createToast(els.toast);
  initTheme(els.themeBtn);

  authDialog = createAuthDialog({
    dialog: els.signinDialog,
    toast,
    onAuthChanged: handleAuthChange,
    getMyPortfolio: () => state.myProfile,
    onRelaysChanged: (list) => {
      state.relays = list;
      if (recentView) recentView.setRelays(list);
      syncMyPortfolio(true);
    },
  });
  confirmModal = createConfirmDialog({
    dialog: els.confirmDialog,
    kicker: els.confirmKicker,
    title: els.confirmTitle,
    message: els.confirmMessage,
    accept: els.confirmAccept,
    cancel: els.confirmCancel,
  });

  editor = createEditorView({
    root: els.editorView,
    toast,
    confirm: confirmModal.open,
    onPublished: handlePublished,
    onClosed: handleEditorClosed,
    onRelaysChanged: (list) => {
      state.relays = list;
      if (recentView) recentView.setRelays(list);
      syncMyPortfolio(true);
    },
    onThemePreview: (theme) => applyPortfolioTheme(theme),
  });

  lightbox = createLightbox({
    dialog: els.lightboxDialog,
    stage: els.lightboxStage,
    title: els.lightboxTitle,
    count: els.lightboxCount,
    caption: els.lightboxCaption,
    prevBtn: els.lightboxPrev,
    nextBtn: els.lightboxNext,
  });

  recentView = createRecentView({
    section: $("#recent-section"),
    getRelays: () => state.relays,
    getAuthPubkey: () => auth.getState().pubkey,
  });

  bindEvents();

  const langSelect = $("#lang-select");
  if (langSelect) {
    langSelect.value = getLang();
    langSelect.addEventListener("change", () => {
      if (editor && editor.isOpen()) editor.flush();
      setLang(langSelect.value);
    });
  }

  auth.onChange(handleAuthChange);
  route();
  auth
    .initAuth()
    .then(() => {
      state.authReady = true;
      maybeOpenRequestedEditor();
    })
    .catch(() => {
      state.authReady = true;
      maybeOpenRequestedEditor();
    });
}

initLang();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    applyTranslations();
    init();
  });
} else {
  applyTranslations();
  init();
}
