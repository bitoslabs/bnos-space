/**
 * Authentication service. Owns the current signer (NIP-07, NIP-46 or a local
 * nsec) and its persistence, and exposes one signing API to the rest of the app.
 */
import * as nip07 from "../nostr/nip07.js";
import {
  Nip46Session,
  connectWithNostrConnect,
  parseBunkerUrl,
} from "../nostr/nip46.js";
import {
  clearAuth,
  clearLocalAuth,
  clearSessionAuth,
  loadRelays,
  readAuth,
  writeAuth,
  writeSessionAuth,
} from "../data/storage.js";
import {
  generateLocalAccount,
  parseSecretKey,
  signWithSecretKey,
} from "../nostr/local-signer.js";

const listeners = new Set();
let current = emptyAuth();
let initialized = false;

function emptyAuth() {
  return { type: null, pubkey: null, session: null };
}

function emit() {
  const snapshot = getState();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      /* listeners must not break auth */
    }
  });
}

export function getState() {
  return {
    type: current.type,
    pubkey: current.pubkey,
    connected: Boolean(current.pubkey),
    remember: current.type === "nsec" ? Boolean(current.remember) : false,
  };
}

export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function retireSession(session) {
  if (session) {
    void session.logout().catch(() => {});
  }
}

function persist(state) {
  if (state.type === "nsec") {
    const record = {
      type: "nsec",
      pubkey: state.pubkey,
      secret: state.secret,
      remember: Boolean(state.remember),
    };
    if (state.remember) {
      if (!writeAuth(record)) {
        throw new Error("Could not store the key on this device.");
      }
      clearSessionAuth();
    } else {
      if (!writeSessionAuth(record)) {
        throw new Error("Could not keep the key in this tab.");
      }
      clearLocalAuth();
    }
    return;
  }
  if (state.type === "nip07") {
    writeAuth({ type: "nip07", pubkey: state.pubkey });
    clearSessionAuth();
    return;
  }
  if (state.type === "nip46" && state.session) {
    const data = state.session.toJSON();
    writeAuth({ type: "nip46", pubkey: data.userPubkey, session: data });
    clearSessionAuth();
  }
}

export async function initAuth() {
  if (initialized) return getState();
  initialized = true;
  const stored = readAuth();

  if (stored && stored.type === "nsec") {
    try {
      const account = parseSecretKey(stored.secret);
      if (stored.pubkey && stored.pubkey !== account.pubkey) {
        throw new Error("Stored key does not match its public key.");
      }
      current = {
        type: "nsec",
        pubkey: account.pubkey,
        session: null,
        secret: account.secretHex,
        remember: Boolean(stored.remember),
      };
    } catch {
      clearAuth();
      current = emptyAuth();
    }
    emit();
    return getState();
  }

  if (stored && stored.type === "nip46") {
    const session = Nip46Session.fromJSON(stored.session);
    if (session && session.userPubkey) {
      current = { type: "nip46", pubkey: session.userPubkey, session };
    } else {
      clearAuth();
    }
    emit();
    return getState();
  }

  if (stored && stored.type === "nip07") {
    if (nip07.hasSigner()) {
      current = { type: "nip07", pubkey: stored.pubkey, session: null };
      emit();
      try {
        const pubkey = await nip07.getPublicKey();
        if (pubkey !== current.pubkey) {
          current = { type: "nip07", pubkey, session: null };
          persist(current);
          emit();
        }
      } catch {
        current = emptyAuth();
        emit();
      }
    }
    return getState();
  }

  emit();
  return getState();
}

export function connectNsec(input, { remember = false } = {}) {
  const account = parseSecretKey(input);
  const next = {
    type: "nsec",
    pubkey: account.pubkey,
    session: null,
    secret: account.secretHex,
    remember: Boolean(remember),
  };
  persist(next);
  const previous = current.session;
  current = next;
  retireSession(previous);
  emit();
  return getState();
}

export function generateAccount() {
  return generateLocalAccount();
}

export async function connectNip07() {
  const pubkey = await nip07.getPublicKey();
  const previous = current.session;
  current = { type: "nip07", pubkey, session: null };
  persist(current);
  retireSession(previous);
  emit();
  return getState();
}

export async function connectBunker(input, { onAuthChallenge = null } = {}) {
  const parsed = parseBunkerUrl(input);
  const session = new Nip46Session({
    remoteSignerPubkey: parsed.remoteSignerPubkey,
    relays: parsed.relays,
    secret: parsed.secret,
    onAuthChallenge,
  });
  try {
    const data = await session.connect();
    const previous = current.session;
    current = { type: "nip46", pubkey: data.userPubkey, session };
    persist(current);
    retireSession(previous);
    emit();
    return getState();
  } catch (error) {
    session.close();
    throw error;
  }
}

export async function connectNostrConnect({
  onUri,
  onAuthChallenge = null,
  signal = null,
} = {}) {
  const relays = loadRelays();
  const session = await connectWithNostrConnect({
    relays,
    onUri,
    onAuthChallenge,
    signal,
  });
  const previous = current.session;
  current = { type: "nip46", pubkey: session.userPubkey, session };
  persist(current);
  retireSession(previous);
  emit();
  return getState();
}

export async function signEvent(unsigned) {
  if (current.type === "nip07") return nip07.signEvent(unsigned);
  if (current.type === "nsec" && current.secret) {
    return signWithSecretKey(unsigned, current.secret);
  }
  if (current.type === "nip46" && current.session) {
    return current.session.signEvent(unsigned);
  }
  throw new Error("Connect a signer before publishing.");
}

export async function disconnect() {
  if (current.type === "nip46" && current.session) {
    await current.session.logout();
  }
  current = emptyAuth();
  clearAuth();
  emit();
}

export function isOwnerOf(pubkey) {
  return Boolean(current.pubkey && pubkey && current.pubkey === pubkey);
}
