/**
 * NIP-05 owner setup: generate the .well-known/nostr.json snippet, let the
 * owner copy it, and verify the live DNS response.
 */
import { $, setHidden } from "../shared/dom.js";
import { copyToClipboard } from "../shared/clipboard.js";
import { buildNip05Setup, verifyNip05 } from "../nostr/nip05.js";

export function createNip05Wizard({
  root,
  getIdentifier,
  getPubkey,
  getRelays,
  toast,
}) {
  const buildButton = $("#nip05-build", root);
  const panel = $("#nip05-panel", root);
  const fileUrl = $("#nip05-file-url", root);
  const jsonEl = $("#nip05-json", root);
  const copyButton = $("#nip05-copy", root);
  const verifyButton = $("#nip05-verify", root);
  const statusEl = $("#nip05-status", root);

  let setup = null;

  function setStatus(message, tone = "") {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.className = "nip05-status" + (tone ? ` is-${tone}` : "");
  }

  function build() {
    const identifier = String(getIdentifier ? getIdentifier() : "").trim();
    const pubkey = getPubkey ? getPubkey() : "";
    if (!pubkey) {
      setStatus("Sign in before generating a NIP-05 file.", "error");
      return;
    }
    const next = buildNip05Setup(
      identifier,
      pubkey,
      getRelays ? getRelays() : []
    );
    if (next.error) {
      setup = null;
      setHidden(panel, true);
      setStatus(next.error, "error");
      return;
    }
    setup = next;
    if (fileUrl) fileUrl.textContent = next.fileUrl;
    if (jsonEl) jsonEl.textContent = next.text;
    setHidden(panel, false);
    setStatus("Not checked yet. Host the file, then verify.", "");
  }

  async function verify() {
    if (!setup) {
      setStatus("Generate the setup file first.", "error");
      return;
    }
    const pubkey = getPubkey ? getPubkey() : "";
    if (!pubkey) {
      setStatus("Sign in before verifying.", "error");
      return;
    }
    setStatus("Checking the domain…", "");
    if (verifyButton) verifyButton.disabled = true;
    try {
      const result = await verifyNip05(
        setup.name + "@" + setup.domain,
        pubkey
      );
      if (result.status === "verified") {
        setStatus("Verified. This address resolves to your key.", "ok");
      } else if (result.status === "mismatch") {
        setStatus(
          "The domain responds, but it points to a different key.",
          "error"
        );
      } else {
        setStatus(result.error || "Could not verify this address.", "error");
      }
    } finally {
      if (verifyButton) verifyButton.disabled = false;
    }
  }

  buildButton?.addEventListener("click", build);
  verifyButton?.addEventListener("click", verify);
  copyButton?.addEventListener("click", async () => {
    if (!setup) return;
    const ok = await copyToClipboard(setup.text);
    if (toast) {
      toast(ok ? "NIP-05 JSON copied." : "Could not copy the JSON.", !ok);
    }
  });

  return {
    reset() {
      setup = null;
      setHidden(panel, true);
      setStatus("", "");
    },
    build,
    getSetup: () => setup,
  };
}
