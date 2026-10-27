/**
 * Relay transport: one-shot queries, event publishing, and long-lived
 * subscriptions. No Nostr event interpretation happens here.
 */
import {
  RELAY_PUBLISH_TIMEOUT,
  RELAY_QUERY_TIMEOUT,
  RELAY_SUBSCRIBE_TIMEOUT,
} from "../config.js";

export { parseRelayUrls } from "../shared/urls.js";

function openSocket(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let socket;
    try {
      socket = new WebSocket(url);
    } catch {
      reject(new Error("Invalid relay URL"));
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new Error("Connection timed out"));
    }, timeoutMs);

    socket.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Could not connect"));
    };
    socket.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Connection closed"));
    };
  });
}

async function queryOne(relay, filter, timeoutMs) {
  const socket = await openSocket(relay, timeoutMs);
  return new Promise((resolve) => {
    const subId = "q" + Math.random().toString(36).slice(2, 10);
    const events = [];
    let done = false;
    let timer = 0;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.send(JSON.stringify(["CLOSE", subId]));
      } catch {
        /* ignore */
      }
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(events);
    };

    timer = window.setTimeout(finish, timeoutMs);
    socket.onmessage = (messageEvent) => {
      let message;
      try {
        message = JSON.parse(messageEvent.data);
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;
      if (message[0] === "EVENT" && message[1] === subId && message[2]) {
        events.push(message[2]);
      } else if (
        (message[0] === "EOSE" || message[0] === "CLOSED") &&
        message[1] === subId
      ) {
        finish();
      }
    };
    socket.onerror = finish;
    socket.onclose = finish;
    try {
      socket.send(JSON.stringify(["REQ", subId, filter]));
    } catch {
      finish();
    }
  });
}

export async function queryRelays(
  relays,
  filter,
  { timeout = RELAY_QUERY_TIMEOUT } = {}
) {
  if (!relays.length) {
    return { events: [], errors: [{ relay: "", error: "No relays configured" }] };
  }

  const results = await Promise.allSettled(
    relays.map((relay) => queryOne(relay, filter, timeout))
  );
  const events = [];
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      events.push(...result.value);
    } else {
      errors.push({
        relay: relays[index],
        error: (result.reason && result.reason.message) || "Failed",
      });
    }
  });

  const seen = new Set();
  const unique = [];
  for (const event of events) {
    if (!event || !event.id || seen.has(event.id)) continue;
    seen.add(event.id);
    unique.push(event);
  }

  return { events: unique, errors };
}

export function newestEvent(events) {
  return events.reduce((best, event) => {
    if (!best) return event;
    return (event.created_at || 0) > (best.created_at || 0) ? event : best;
  }, null);
}

async function publishOne(relay, event, timeoutMs) {
  const socket = await openSocket(relay, timeoutMs);
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = 0;

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      fn(value);
    };

    timer = window.setTimeout(
      () => finish(reject, new Error("Timed out waiting for OK")),
      timeoutMs
    );
    socket.onmessage = (messageEvent) => {
      let message;
      try {
        message = JSON.parse(messageEvent.data);
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;
      if (message[0] === "OK" && message[1] === event.id) {
        if (message[2]) finish(resolve, message[3] || "accepted");
        else finish(reject, new Error(message[3] || "Rejected by relay"));
      }
    };
    socket.onerror = () => finish(reject, new Error("Connection error"));
    socket.onclose = () => finish(reject, new Error("Connection closed"));
    try {
      socket.send(JSON.stringify(["EVENT", event]));
    } catch {
      finish(reject, new Error("Could not send event"));
    }
  });
}

export async function publishToRelays(
  relays,
  event,
  { timeout = RELAY_PUBLISH_TIMEOUT, onProgress } = {}
) {
  const total = relays.length;
  let done = 0;

  return Promise.all(
    relays.map(async (relay) => {
      let result;
      try {
        const message = await publishOne(relay, event, timeout);
        result = { relay, ok: true, message };
      } catch (error) {
        result = {
          relay,
          ok: false,
          message: (error && error.message) || "Failed",
        };
      }
      done += 1;
      if (onProgress) {
        try {
          onProgress({ done, total });
        } catch {
          /* progress reporting must not break publishing */
        }
      }
      return result;
    })
  );
}

async function subscribeOne(relay, filter, onEvent, timeoutMs, onClose) {
  const socket = await openSocket(relay, timeoutMs);
  const subId = "s" + Math.random().toString(36).slice(2, 10);
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      socket.send(JSON.stringify(["CLOSE", subId]));
    } catch {
      /* ignore */
    }
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  };

  socket.onmessage = (messageEvent) => {
    let message;
    try {
      message = JSON.parse(messageEvent.data);
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;
    if (message[0] === "EVENT" && message[1] === subId && message[2]) {
      onEvent(message[2]);
    } else if (message[0] === "CLOSED" && message[1] === subId) {
      close();
      onClose();
    }
  };
  socket.onerror = () => {
    close();
    onClose();
  };
  socket.onclose = () => {
    if (closed) return;
    closed = true;
    onClose();
  };

  try {
    socket.send(JSON.stringify(["REQ", subId, filter]));
  } catch {
    close();
    throw new Error("Could not subscribe");
  }

  return { close };
}

/**
 * Open the same filter on several relays and keep the sockets alive.
 * `ready` is the number of relays that accepted the subscription.
 */
export async function subscribe(
  relays,
  filter,
  onEvent,
  { timeout = RELAY_SUBSCRIBE_TIMEOUT, onClose = () => {} } = {}
) {
  const settled = await Promise.allSettled(
    relays.map((relay) =>
      subscribeOne(relay, filter, onEvent, timeout, onClose)
    )
  );
  const handles = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  return {
    ready: handles.length,
    close() {
      handles.forEach((handle) => handle.close());
    },
  };
}
