/**
 * NIP-46 remote signer ("bunker") support.
 *
 * The user's private key never reaches this page. A disposable client keypair
 * talks NIP-44-encrypted JSON-RPC to the remote signer over kind 24133 events.
 */
import {
  NIP46_APPROVAL_TIMEOUT,
  NIP46_CONNECT_TIMEOUT,
  NIP46_KIND,
  NIP46_PERMS,
  NIP46_SHORT_TIMEOUT,
  CLIENT_METADATA,
} from "../config.js";
import { parseRelayUrls } from "../shared/urls.js";
import { isHex64 } from "../shared/bech32.js";
import { publishToRelays, subscribe } from "./relay.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  verifyEvent,
} from "./crypto.js";

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(String(hex || ""))) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomHex(bytes = 16) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToHex(data);
}

function requestId() {
  return randomHex(8);
}

function unwrapString(value) {
  if (typeof value !== "string") return String(value == null ? "" : value);
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
  } catch {
    /* plain string */
  }
  return value;
}

function conversationKey(secretKey, pubkey) {
  return nip44.v2.utils.getConversationKey(secretKey, pubkey);
}

function encrypt(secretKey, pubkey, value) {
  return nip44.v2.encrypt(
    JSON.stringify(value),
    conversationKey(secretKey, pubkey)
  );
}

function decrypt(secretKey, pubkey, content) {
  return JSON.parse(
    nip44.v2.decrypt(content, conversationKey(secretKey, pubkey))
  );
}

export function parseBunkerUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new Error("That is not a valid bunker:// URL.");
  }
  if (url.protocol !== "bunker:") {
    throw new Error("The connection token must start with bunker://.");
  }
  const remoteSignerPubkey = (
    url.hostname || url.pathname.replace(/^\/+/, "")
  ).toLowerCase();
  if (!isHex64(remoteSignerPubkey)) {
    throw new Error("The bunker URL does not contain a valid signer pubkey.");
  }
  const relays = url.searchParams
    .getAll("relay")
    .flatMap((relay) => parseRelayUrls(relay));
  if (!relays.length) {
    throw new Error("The bunker URL does not contain a relay.");
  }
  return {
    remoteSignerPubkey,
    relays: Array.from(new Set(relays)),
    secret: url.searchParams.get("secret") || "",
  };
}

export function buildNostrConnectUri(
  clientPubkey,
  relays,
  secret,
  perms = NIP46_PERMS
) {
  const params = new URLSearchParams();
  relays.forEach((relay) => params.append("relay", relay));
  params.set("secret", secret);
  params.set("perms", perms);
  params.set("name", CLIENT_METADATA.name);
  params.set("url", CLIENT_METADATA.url);
  return `nostrconnect://${clientPubkey}?${params.toString()}`;
}

export class Nip46Session {
  constructor({
    remoteSignerPubkey = null,
    relays,
    secret = "",
    clientSecretKey = null,
    userPubkey = null,
    discoverySecret = "",
    onAuthChallenge = null,
  }) {
    this.remoteSignerPubkey = remoteSignerPubkey
      ? remoteSignerPubkey.toLowerCase()
      : null;
    this.relays = Array.from(new Set(relays || [])).slice(0, 4);
    this.secret = secret || "";
    this.clientSecretKey = clientSecretKey || generateSecretKey();
    this.clientPubkey = getPublicKey(this.clientSecretKey);
    this.userPubkey = userPubkey || null;
    this.discoverySecret = discoverySecret || "";
    this.onAuthChallenge = onAuthChallenge;
    this.pending = new Map();
    this.subscription = null;
    this.discovery = null;
    this.closed = false;
  }

  static fromJSON(data) {
    if (!data || !data.clientSecretKey || !data.remoteSignerPubkey) return null;
    const secretKey = hexToBytes(data.clientSecretKey);
    if (!secretKey) return null;
    return new Nip46Session({
      remoteSignerPubkey: data.remoteSignerPubkey,
      relays: data.relays,
      clientSecretKey: secretKey,
      userPubkey: data.userPubkey,
    });
  }

  toJSON() {
    return {
      remoteSignerPubkey: this.remoteSignerPubkey,
      relays: this.relays,
      clientSecretKey: bytesToHex(this.clientSecretKey),
      clientPubkey: this.clientPubkey,
      userPubkey: this.userPubkey,
    };
  }

  async connect() {
    if (!this.remoteSignerPubkey) {
      throw new Error("This session has no remote signer.");
    }
    await this._ensureSubscription();
    const params = [
      this.remoteSignerPubkey,
      this.secret || "",
      NIP46_PERMS,
      JSON.stringify(CLIENT_METADATA),
    ];
    const result = await this._request(
      "connect",
      params,
      NIP46_CONNECT_TIMEOUT
    );
    const connectResult = unwrapString(result);
    if (
      this.secret &&
      connectResult !== "ack" &&
      connectResult !== this.secret
    ) {
      throw new Error("The signer did not return the expected secret.");
    }
    return this._finishConnection();
  }

  async _finishConnection() {
    this.userPubkey = unwrapString(
      await this._request("get_public_key", [], NIP46_SHORT_TIMEOUT * 3)
    )
      .trim()
      .toLowerCase();
    if (!isHex64(this.userPubkey)) {
      throw new Error("The signer returned an invalid user pubkey.");
    }
    await this._switchRelaysIfNeeded();
    return this.toJSON();
  }

  async _ensureSubscription() {
    if (this.closed) throw new Error("The signer session was closed.");
    if (this.subscription && this.subscription.ready) return;
    const filter = {
      kinds: [NIP46_KIND],
      "#p": [this.clientPubkey],
    };
    if (this.remoteSignerPubkey) {
      filter.authors = [this.remoteSignerPubkey];
    }
    this.subscription = await subscribe(
      this.relays,
      filter,
      (event) => this._handleEvent(event),
      { timeout: 8000 }
    );
    if (!this.subscription.ready) {
      throw new Error("Could not reach the signer relays. Check your connection.");
    }
  }

  _closeSubscription() {
    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }
  }

  async _switchRelaysIfNeeded() {
    let switched = null;
    try {
      switched = await this._request("switch_relays", [], 3000);
    } catch {
      return;
    }
    let list = switched;
    if (typeof list === "string") {
      try {
        list = JSON.parse(list);
      } catch {
        list = null;
      }
    }
    if (!Array.isArray(list)) return;
    const relays = parseRelayUrls(list.join(" "));
    if (!relays.length) return;
    this.relays = relays;
    this._closeSubscription();
    await this._ensureSubscription();
  }

  async signEvent(unsigned, timeout = NIP46_APPROVAL_TIMEOUT) {
    if (!this.userPubkey) {
      throw new Error("Connect the remote signer before publishing.");
    }
    await this._ensureSubscription();
    const result = await this._request(
      "sign_event",
      [JSON.stringify(unsigned)],
      timeout
    );
    const signed = typeof result === "string" ? JSON.parse(result) : result;
    if (!signed || !verifyEvent(signed)) {
      throw new Error("The signer returned an invalid signature.");
    }
    if (String(signed.pubkey).toLowerCase() !== this.userPubkey) {
      throw new Error("The signer signed with a different key.");
    }
    return signed;
  }

  async _request(method, params, timeout) {
    if (this.closed) throw new Error("The signer session was closed.");
    if (!this.remoteSignerPubkey) {
      throw new Error("The remote signer is not connected.");
    }
    const id = requestId();
    const payload = { id, method, params };
    const event = finalizeEvent(
      {
        kind: NIP46_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", this.remoteSignerPubkey]],
        content: encrypt(this.clientSecretKey, this.remoteSignerPubkey, payload),
      },
      this.clientSecretKey
    );

    const response = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The signer did not respond in time."));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
    });

    const results = await publishToRelays(this.relays, event);
    if (!results.some((result) => result.ok)) {
      const waiter = this.pending.get(id);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.pending.delete(id);
        waiter.reject(
          new Error("No signer relay accepted the request. Check the relay list.")
        );
      }
    }
    return response;
  }

  _handleEvent(event) {
    if (!event || event.kind !== NIP46_KIND) return;
    if (!verifyEvent(event)) return;
    if (
      !Array.isArray(event.tags) ||
      !event.tags.some(
        (tag) => Array.isArray(tag) && tag[0] === "p" && tag[1] === this.clientPubkey
      )
    ) {
      return;
    }
    if (
      this.remoteSignerPubkey &&
      String(event.pubkey).toLowerCase() !== this.remoteSignerPubkey
    ) {
      return;
    }

    let message;
    try {
      message = decrypt(this.clientSecretKey, event.pubkey, event.content);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;

    if (this.discovery && !this.remoteSignerPubkey) {
      if (
        this.discoverySecret &&
        unwrapString(message.result) === this.discoverySecret
      ) {
        this.remoteSignerPubkey = String(event.pubkey).toLowerCase();
        const resolve = this.discovery.resolve;
        this._clearDiscovery();
        resolve(this.remoteSignerPubkey);
      } else if (isAuthUrl(message)) {
        this._authChallenge(message);
      }
      return;
    }

    const waiter = this.pending.get(message.id);
    if (!waiter) return;

    if (message.error) {
      if (isAuthUrl(message)) {
        this._authChallenge(message);
        return;
      }
      clearTimeout(waiter.timer);
      this.pending.delete(message.id);
      waiter.reject(new Error(String(message.error)));
      return;
    }

    clearTimeout(waiter.timer);
    this.pending.delete(message.id);
    waiter.resolve(message.result);
  }

  _authChallenge(message) {
    const url = String(message.error || "");
    if (this.onAuthChallenge) this.onAuthChallenge(url);
  }

  _clearDiscovery() {
    if (!this.discovery) return;
    clearTimeout(this.discovery.timer);
    this.discovery = null;
  }

  async waitForDiscovery(timeout = NIP46_CONNECT_TIMEOUT, signal = null) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new Error("Connection cancelled."));
        return;
      }
      const timer = window.setTimeout(() => {
        this.discovery = null;
        reject(new Error("The signer app did not approve the connection."));
      }, timeout);
      this.discovery = { resolve, reject, timer };
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            if (!this.discovery) return;
            this._clearDiscovery();
            reject(new Error("Connection cancelled."));
          },
          { once: true }
        );
      }
    });
  }

  async logout() {
    if (this.remoteSignerPubkey) {
      try {
        await this._request("logout", [], 5000);
      } catch {
        /* best effort */
      }
    }
    this.close();
  }

  close() {
    this.closed = true;
    this._closeSubscription();
    if (this.discovery) {
      const reject = this.discovery.reject;
      this._clearDiscovery();
      reject(new Error("Connection cancelled."));
    }
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("The signer connection closed."));
    }
    this.pending.clear();
  }
}

function isAuthUrl(message) {
  return (
    message &&
    String(message.result || "") === "auth_url" &&
    /^https?:\/\//i.test(String(message.error || ""))
  );
}

/**
 * Client-initiated NIP-46: generate a nostrconnect:// URI, wait for a signer
 * app to approve it, then ask for the user's pubkey.
 */
export async function connectWithNostrConnect({
  relays,
  onUri,
  onAuthChallenge = null,
  timeout = NIP46_CONNECT_TIMEOUT,
  signal = null,
}) {
  const clientSecretKey = generateSecretKey();
  const secret = randomHex(8);
  const session = new Nip46Session({
    relays,
    clientSecretKey,
    discoverySecret: secret,
    onAuthChallenge,
  });
  const uri = buildNostrConnectUri(session.clientPubkey, session.relays, secret);

  try {
    await session._ensureSubscription();
    const discovery = session.waitForDiscovery(timeout, signal);
    onUri(uri);
    await discovery;
    await session._finishConnection();
    return session;
  } catch (error) {
    session.close();
    throw error;
  }
}
