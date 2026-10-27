/**
 * Sign-in dialog: NIP-07 extension, NIP-46 bunker URL, or NIP-46
 * client-initiated connection. Owns only dialog state and delegated auth calls.
 */
import { $, $$, esc, setHidden } from "../shared/dom.js";
import { hexToNpub } from "../shared/bech32.js";
import { profileName, shortKey, timeAgo } from "../shared/format.js";
import { copyToClipboard } from "../shared/clipboard.js";
import { parseRelayUrls, profilePageUrl } from "../shared/urls.js";
import { loadRelays, saveRelays } from "../data/storage.js";
import { hasSigner } from "../nostr/nip07.js";
import * as auth from "../services/auth.js";
import { clearQr, renderQr } from "./qr.js";
import { t } from "../shared/i18n.js";

export function createAuthDialog({
  dialog,
  toast,
  onAuthChanged,
  onRelaysChanged,
  getMyPortfolio,
}) {
  const els = {
    title: $("#signin-title", dialog),
    signerDot: $("#signer-dot", dialog),
    signerLabel: $("#signer-label", dialog),
    signerId: $("#signer-id", dialog),
    myPortfolioCard: $("#my-portfolio-card", dialog),
    myPortfolioName: $("#my-portfolio-name", dialog),
    myPortfolioStatus: $("#my-portfolio-status", dialog),
    myPortfolioUrl: $("#my-portfolio-url", dialog),
    myPortfolioView: $("#my-portfolio-view", dialog),
    myPortfolioEdit: $("#my-portfolio-edit", dialog),
    connectNip07: $("#connect-signer", dialog),
    connectNip07Label: $("#connect-signer-label", dialog),
    signout: $("#signout-btn", dialog),
    authStatus: $("#auth-status", dialog),
    nip07Note: $("#nip07-note", dialog),
    nsecKey: $("#nsec-key", dialog),
    nsecRemember: $("#nsec-remember", dialog),
    nsecStatus: $("#nsec-status", dialog),
    toggleNsec: $("#toggle-nsec", dialog),
    connectNsec: $("#connect-nsec", dialog),
    createStart: $("#create-start", dialog),
    createResult: $("#create-result", dialog),
    createNpub: $("#create-npub", dialog),
    createNsec: $("#create-nsec", dialog),
    copyCreateNpub: $("#copy-create-npub", dialog),
    copyCreateNsec: $("#copy-create-nsec", dialog),
    createSaved: $("#create-saved", dialog),
    createRemember: $("#create-remember", dialog),
    createContinue: $("#create-continue", dialog),
    createAgain: $("#create-again", dialog),
    createStatus: $("#create-status", dialog),
    bunkerUrl: $("#bunker-url", dialog),
    connectBunker: $("#connect-bunker", dialog),
    startNostrConnect: $("#start-nostrconnect", dialog),
    nostrConnectBox: $("#nostrconnect-box", dialog),
    nostrConnectUri: $("#nostrconnect-uri", dialog),
    nostrConnectQr: $("#nostrconnect-qr", dialog),
    copyNostrConnect: $("#copy-nostrconnect", dialog),
    openNostrConnect: $("#open-nostrconnect", dialog),
    cancelNostrConnect: $("#cancel-nostrconnect", dialog),
    nip46Status: $("#nip46-status", dialog),
    relays: $("#signin-relays", dialog),
    saveRelays: $("#save-signin-relays", dialog),
  };

  let nostrConnectController = null;
  let activeTab = "nip07";
  let generatedAccount = null;

  function setStatus(element, message, { error = false, url = "" } = {}) {
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("is-error", Boolean(error));
    if (url && /^https?:\/\//i.test(url)) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = " Open approval link";
      element.appendChild(link);
    }
  }

  function setTab(tab) {
    activeTab = tab;
    if (els.title) {
      const state = auth.getState();
      els.title.textContent = state.connected
        ? t("Nostr account")
        : tab === "create"
        ? t("Create a Nostr account")
        : t("Sign in with a Nostr signer");
    }
    $$("[data-auth-tab]", dialog).forEach((button) => {
      const active = button.getAttribute("data-auth-tab") === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$("[data-auth-panel]", dialog).forEach((panel) => {
      setHidden(panel, panel.getAttribute("data-auth-panel") !== tab);
    });
  }

  function renderMyPortfolio(state) {
    if (!els.myPortfolioCard) return;
    if (!state || !state.pubkey) {
      setHidden(els.myPortfolioCard, true);
      return;
    }

    const portfolioState = getMyPortfolio ? getMyPortfolio() : null;
    const mine =
      portfolioState && portfolioState.pubkey === state.pubkey
        ? portfolioState
        : null;
    const npub = hexToNpub(state.pubkey);
    const profile = mine && mine.profile;
    const published = Boolean(mine && mine.status === "published");
    const empty = Boolean(mine && mine.status === "empty");
    const checking = !mine || mine.status === "loading" || mine.status === "idle";
    const errored = Boolean(mine && mine.status === "error");
    const viewUrl = profilePageUrl(npub);
    const editUrl = profilePageUrl(npub, { edit: true });

    const name =
      profile && profileName(profile) !== "Unnamed profile"
        ? profileName(profile)
        : t("Your business page");

    els.myPortfolioName.textContent = name;
    els.myPortfolioUrl.textContent = `bnos.space/b/${shortKey(npub)}`;
    els.myPortfolioView.href = viewUrl;
    els.myPortfolioEdit.href = editUrl;
    els.myPortfolioEdit.textContent = published
      ? t("Edit business page")
      : empty
      ? t("Create business page")
      : t("Open business page");

    let status = t("Checking relays…");
    let tone = "";
    if (published) {
      status = mine.updatedAt
        ? t("Published · {time}", { time: timeAgo(mine.updatedAt) })
        : t("Published");
      tone = "is-ok";
    } else if (empty) {
      status = t("Not published yet");
    } else if (errored) {
      status = t("Could not check relays");
      tone = "is-error";
    } else if (!checking) {
      status = t("Business page status");
    }

    els.myPortfolioStatus.textContent = status;
    els.myPortfolioStatus.className = "my-portfolio-status" + (tone ? ` ${tone}` : "");
    setHidden(els.myPortfolioCard, false);
  }

  function render() {
    const state = auth.getState();
    const detected = hasSigner();

    els.signerDot.className = "signer-dot " + (state.connected ? "ok" : "");
    els.signerLabel.textContent = state.connected
      ? state.type === "nip46"
        ? t("Connected with a remote signer")
        : state.type === "nsec"
        ? t("Connected with a local key")
        : t("Connected with NIP-07")
      : t("Not signed in");

    if (state.connected) {
      const npub = hexToNpub(state.pubkey);
      const localNote =
        state.type === "nsec"
          ? `<br><span>Local key · ${
              state.remember ? "remembered on this device" : "session only"
            }</span>`
          : "";
      els.signerId.innerHTML = `<span class="ok">Signed in</span><br><code>${esc(
        npub
      )}</code><br><span>${esc(state.pubkey)}</span>${localNote}`;
      setHidden(els.signerId, false);
      setHidden(els.signout, false);
      setHidden(els.connectNip07, true);
    } else {
      els.signerId.innerHTML = "";
      setHidden(els.signerId, true);
      setHidden(els.signout, true);
      setHidden(els.connectNip07, false);
    }

    const localConnected = state.connected && state.type === "nsec";
    els.nsecKey.disabled = localConnected;
    els.nsecRemember.disabled = localConnected;
    els.connectNsec.disabled = localConnected;

    renderMyPortfolio(state);

    if (els.nip07Note) {
      els.nip07Note.textContent = detected
        ? "A NIP-07 extension is available in this browser. Your key stays inside the extension."
        : "No NIP-07 extension detected. Install Alby, nos2x, or another NIP-07 signer, then reload. Or use a NIP-46 remote signer below.";
    }
    if (els.connectNip07Label) {
      els.connectNip07Label.textContent = detected
        ? t("Connect NIP-07 signer")
        : t("Retry NIP-07 detection");
    }
    setTab(activeTab);
  }

  function open() {
    const state = auth.getState();
    activeTab = state.connected
      ? state.type === "nip46"
        ? "nip46"
        : state.type === "nsec"
        ? "nsec"
        : "nip07"
      : hasSigner()
      ? "nip07"
      : "create";
    setStatus(els.authStatus, "");
    setStatus(els.nip46Status, "");
    setStatus(els.nsecStatus, "");
    setStatus(els.createStatus, "");
    resetCreateAccount();
    els.nsecKey.value = "";
    els.nsecKey.type = "password";
    els.nsecRemember.checked = false;
    els.toggleNsec.setAttribute("aria-label", t("Show private key"));
    els.toggleNsec.setAttribute("title", t("Show private key"));
    setHidden(els.nostrConnectBox, true);
    els.openNostrConnect.hidden = true;
    clearQr(els.nostrConnectQr);
    els.relays.value = loadRelays().join("\n");
    render();
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function close() {
    if (dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  async function connectNip07() {
    setStatus(els.authStatus, "Waiting for the browser extension…");
    try {
      await auth.connectNip07();
      setStatus(els.authStatus, "Connected.");
      if (onAuthChanged) onAuthChanged();
      close();
      toast("Signed in with NIP-07.");
    } catch (error) {
      setStatus(
        els.authStatus,
        (error && error.message) || "Sign-in failed.",
        { error: true }
      );
    }
  }

  function resetCreateAccount() {
    generatedAccount = null;
    els.createResult.hidden = true;
    els.createStart.hidden = false;
    els.createNpub.textContent = "";
    els.createNsec.textContent = "";
    els.createSaved.checked = false;
    els.createRemember.checked = false;
    els.createContinue.disabled = true;
    setStatus(els.createStatus, "");
  }

  function startCreateAccount() {
    try {
      generatedAccount = auth.generateAccount();
      els.createNpub.textContent = generatedAccount.npub;
      els.createNsec.textContent = generatedAccount.nsec;
      els.createStart.hidden = true;
      els.createResult.hidden = false;
      els.createContinue.disabled = true;
      els.createSaved.checked = false;
      setStatus(
        els.createStatus,
        "Save the nsec shown above. It will not be shown again."
      );
      els.createResult.scrollIntoView({ block: "nearest" });
      els.createSaved.focus();
    } catch (error) {
      setStatus(
        els.createStatus,
        (error && error.message) || "Could not create an account.",
        { error: true }
      );
    }
  }

  async function continueCreateAccount() {
    if (!generatedAccount || !els.createSaved.checked) return;
    els.createContinue.disabled = true;
    setStatus(els.createStatus, "Signing in with the new key…");
    try {
      await auth.connectNsec(generatedAccount.secretHex, {
        remember: els.createRemember.checked,
      });
      const npub = generatedAccount.npub;
      resetCreateAccount();
      if (onAuthChanged) onAuthChanged();
      close();
      toast(`Account created. Back up your nsec to keep ${npub.slice(0, 12)}… safe.`);
    } catch (error) {
      setStatus(
        els.createStatus,
        (error && error.message) || "Could not sign in with the new key.",
        { error: true }
      );
      els.createContinue.disabled = false;
    }
  }

  async function copyAccountKey(value, label) {
    const ok = await copyToClipboard(value);
    toast(ok ? `${label} copied.` : `Could not copy the ${label.toLowerCase()}.`, !ok);
  }

  async function connectWithNsec() {
    const input = els.nsecKey.value.trim();
    if (!input) {
      setStatus(els.nsecStatus, "Paste your nsec or secret key first.", {
        error: true,
      });
      els.nsecKey.focus();
      return;
    }
    els.connectNsec.disabled = true;
    setStatus(els.nsecStatus, "Checking the key…");
    try {
      await auth.connectNsec(input, {
        remember: els.nsecRemember.checked,
      });
      els.nsecKey.value = "";
      setStatus(els.nsecStatus, "Connected.");
      if (onAuthChanged) onAuthChanged();
      close();
      toast("Signed in with a local key.");
    } catch (error) {
      setStatus(
        els.nsecStatus,
        (error && error.message) || "Could not sign in with that key.",
        { error: true }
      );
    } finally {
      const state = auth.getState();
      els.connectNsec.disabled =
        state.connected && state.type === "nsec";
    }
  }

  async function connectBunker() {
    const input = els.bunkerUrl.value.trim();
    if (!input) {
      setStatus(els.nip46Status, "Paste a bunker:// URL first.", {
        error: true,
      });
      return;
    }
    els.connectBunker.disabled = true;
    setStatus(
      els.nip46Status,
      "Waiting for your remote signer to approve the connection…"
    );
    try {
      await auth.connectBunker(input, {
        onAuthChallenge(url) {
          setStatus(
            els.nip46Status,
            "The signer needs approval in another window.",
            { url }
          );
        },
      });
      setStatus(els.nip46Status, "Connected.");
      if (onAuthChanged) onAuthChanged();
      close();
      toast("Signed in with a remote signer.");
    } catch (error) {
      setStatus(
        els.nip46Status,
        (error && error.message) || "Could not connect the remote signer.",
        { error: true }
      );
    } finally {
      els.connectBunker.disabled = false;
    }
  }

  async function startNostrConnect() {
    if (nostrConnectController) nostrConnectController.abort();
    const controller = new AbortController();
    nostrConnectController = controller;
    els.startNostrConnect.disabled = true;
    setHidden(els.nostrConnectBox, false);
    clearQr(els.nostrConnectQr);
    setStatus(els.nip46Status, "Waiting for a signer app to approve…");

    try {
      await auth.connectNostrConnect({
        signal: controller.signal,
        onUri(uri) {
          els.nostrConnectUri.value = uri;
          els.openNostrConnect.href = uri;
          els.openNostrConnect.hidden = false;
          renderQr(els.nostrConnectQr, uri);
          setStatus(
            els.nip46Status,
            "Waiting for approval in your signer app…"
          );
        },
        onAuthChallenge(url) {
          setStatus(
            els.nip46Status,
            "The signer needs approval in another window.",
            { url }
          );
        },
      });
      setStatus(els.nip46Status, "Connected.");
      nostrConnectController = null;
      if (onAuthChanged) onAuthChanged();
      close();
      toast("Signed in with a remote signer.");
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(
          els.nip46Status,
          (error && error.message) || "Could not connect the signer app.",
          { error: true }
        );
      }
    } finally {
      els.startNostrConnect.disabled = false;
      if (nostrConnectController === controller) nostrConnectController = null;
    }
  }

  function cancelNostrConnect() {
    if (nostrConnectController) {
      nostrConnectController.abort();
      nostrConnectController = null;
    }
    setHidden(els.nostrConnectBox, true);
    els.openNostrConnect.hidden = true;
    clearQr(els.nostrConnectQr);
    setStatus(els.nip46Status, "Connection cancelled.");
  }

  async function signOut() {
    setStatus(els.authStatus, "Signing out…");
    try {
      await auth.disconnect();
    } catch {
      /* local state is cleared regardless */
    }
    render();
    if (onAuthChanged) onAuthChanged();
    toast("Signed out.");
  }

  function saveRelaySettings() {
    const list = parseRelayUrls(els.relays.value);
    if (!list.length) {
      toast("Add at least one wss:// relay URL.", true);
      return;
    }
    const saved = saveRelays(list);
    els.relays.value = saved.join("\n");
    if (onRelaysChanged) onRelaysChanged(saved);
    toast(`Relay list saved (${saved.length}).`);
  }

  $$("[data-auth-tab]", dialog).forEach((button) => {
    button.addEventListener("click", () => {
      setTab(button.getAttribute("data-auth-tab"));
    });
  });
  els.connectNip07.addEventListener("click", connectNip07);
  els.connectNsec.addEventListener("click", connectWithNsec);
  els.toggleNsec.addEventListener("click", () => {
    const reveal = els.nsecKey.type === "password";
    els.nsecKey.type = reveal ? "text" : "password";
    const label = reveal ? t("Hide private key") : t("Show private key");
    els.toggleNsec.setAttribute("aria-label", label);
    els.toggleNsec.setAttribute("title", label);
  });
  els.createStart.addEventListener("click", startCreateAccount);
  els.createAgain.addEventListener("click", startCreateAccount);
  els.createSaved.addEventListener("change", () => {
    els.createContinue.disabled = !els.createSaved.checked;
  });
  els.createContinue.addEventListener("click", continueCreateAccount);
  els.copyCreateNpub.addEventListener("click", () => {
    if (generatedAccount) void copyAccountKey(generatedAccount.npub, "npub");
  });
  els.copyCreateNsec.addEventListener("click", () => {
    if (generatedAccount) void copyAccountKey(generatedAccount.nsec, "nsec");
  });
  els.connectBunker.addEventListener("click", connectBunker);
  els.startNostrConnect.addEventListener("click", startNostrConnect);
  els.cancelNostrConnect.addEventListener("click", cancelNostrConnect);
  els.signout.addEventListener("click", signOut);
  els.saveRelays.addEventListener("click", saveRelaySettings);
  els.copyNostrConnect.addEventListener("click", async () => {
    const uri = els.nostrConnectUri.value;
    const ok = await copyToClipboard(uri);
    toast(ok ? "Connection link copied." : "Could not copy the link.", !ok);
  });
  dialog.addEventListener("close", () => {
    if (nostrConnectController) {
      nostrConnectController.abort();
      nostrConnectController = null;
    }
    els.nsecKey.value = "";
    els.nsecKey.type = "password";
    els.nsecRemember.checked = false;
    resetCreateAccount();
  });

  return { open, close, render };
}
