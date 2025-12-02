// ===============================================
// src/ui/pages/Online/lib/transport.js
// Transporte unificado:
//  - "ws": WebSocket con reconexión, rejoin y status callbacks.
//  - "bc": BroadcastChannel por sala, con presencia simple (peers aproximado).
//
// API:
//  export const PROTO_V = 1;
//  export function createTransport(kind, room, onMessage, onStatus, opts?)
//    -> devuelve { send(obj), close() }
//
// onStatus({ state, room, peers?, attempt?, delayMs? })
// states: "connecting" | "open" | "retrying" | "error" | "closed" | "unsupported"
//
// Notas:
//  - NO mutamos el payload del usuario. El caller ya adjunta {v, room, clientId}.
//  - En WS, al abrir, enviamos {t:"join"} automáticamente.
//  - En reconexión WS, hacemos rejoin y el caller típicamente solicita snapshot.
// ===============================================

export const PROTO_V = 1;

// Utils
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jitter(ms, ratio = 0.25) {
  const delta = ms * ratio;
  const off = (Math.random() * 2 - 1) * delta;
  return Math.max(0, Math.floor(ms + off));
}

function sanitizeRoom(s) {
  return String(s || "sala1")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 48);
}

// -------------------------------------------------
// BroadcastChannel transport
// -------------------------------------------------
function createBCTransport(room, onMessage, onStatus) {
  const r = sanitizeRoom(room);
  if (
    typeof window === "undefined" ||
    typeof window.BroadcastChannel !== "function"
  ) {
    try {
      onStatus?.({ state: "unsupported", room: r });
    } catch {}
    return {
      send() {},
      close() {},
    };
  }

  const chanName = `D10:${r}`;
  const ch = new BroadcastChannel(chanName);

  // Presencia simple: cada tab tiene un id y anuncia "hello"/"bye".
  const peerId = Math.random().toString(36).slice(2);
  const peers = new Set(); // ids remotos
  let closed = false;

  function post(msg) {
    try {
      ch.postMessage(msg);
    } catch {}
  }

  // Anunciar presencia
  function announceHello() {
    post({ t: "hello", room: r, peerId });
  }

  // Arranque
  announceHello();
  try {
    onStatus?.({ state: "open", room: r, peers: peers.size });
  } catch {}

  ch.onmessage = (ev) => {
    const msg = ev?.data;
    if (!msg || typeof msg !== "object") return;

    // Presencia (no reenviamos al app)
    if (msg.t === "hello" && msg.peerId && msg.peerId !== peerId) {
      if (!peers.has(msg.peerId)) {
        peers.add(msg.peerId);
        try {
          onStatus?.({ state: "open", room: r, peers: peers.size });
        } catch {}
      }
      return;
    }
    if (msg.t === "bye" && msg.peerId && msg.peerId !== peerId) {
      if (peers.delete(msg.peerId)) {
        try {
          onStatus?.({ state: "open", room: r, peers: peers.size });
        } catch {}
      }
      return;
    }

    // Mensaje de app
    try {
      onMessage?.(msg);
    } catch {}
  };

  // Reanunciar cada cierto tiempo para mantener peers "vivos"
  const helloInterval = setInterval(() => {
    if (closed) return;
    announceHello();
  }, 5000);

  return {
    send(obj) {
      // El caller adjunta {room, v}, aquí no mutamos.
      post(obj);
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        clearInterval(helloInterval);
      } catch {}
      try {
        post({ t: "bye", room: r, peerId });
      } catch {}
      try {
        ch.close();
      } catch {}
      try {
        onStatus?.({ state: "closed", room: r, peers: peers.size });
      } catch {}
    },
  };
}

// -------------------------------------------------
// WebSocket transport con reconexión
// -------------------------------------------------
function createWSTransport(room, onMessage, onStatus, opts = {}) {
  const r = sanitizeRoom(room);
  const url = String(opts.wsUrl || "").trim();
  const WS = typeof window !== "undefined" ? window.WebSocket : null;
  if (!WS) {
    // Entorno sin WebSocket (muy raro en navegador)
    try {
      onStatus?.({ state: "error", room: r });
    } catch {}
    return { send() {}, close() {} };
  }

  let ws = null;
  let manualClose = false;
  let attempt = 0;

  const BACKOFF = {
    base: 400, // ms
    factor: 2.0, // x
    max: 5000, // ms
  };

  async function connectLoop() {
    // Primer estado: connecting
    try {
      onStatus?.({ state: "connecting", room: r });
    } catch {}

    while (!manualClose) {
      try {
        ws = new WS(url);
      } catch (e) {
        // fallo al construir → esperar y reintentar
        attempt++;
        const delay = jitter(
          clamp(
            BACKOFF.base * Math.pow(BACKOFF.factor, attempt - 1),
            BACKOFF.base,
            BACKOFF.max
          )
        );
        try {
          onStatus?.({
            state: "retrying",
            room: r,
            attempt,
            delayMs: delay,
          });
        } catch {}
        await sleep(delay);
        continue;
      }

      // wiring
      ws.onopen = () => {
        attempt = 0;
        try {
          onStatus?.({ state: "open", room: r });
        } catch {}
        // Hacemos JOIN para registrar sala en el relay
        try {
          ws.send(JSON.stringify({ t: "join", room: r, v: PROTO_V }));
        } catch {}
      };

      ws.onmessage = (ev) => {
        let msg = null;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        try {
          onMessage?.(msg);
        } catch {}
      };

      ws.onerror = () => {
        // Error transitorio; anunciamos "error" y forzamos cierre (para que onclose dispare retry)
        try {
          onStatus?.({ state: "error", room: r });
        } catch {}
        try {
          ws.close();
        } catch {}
      };

      ws.onclose = () => {
        if (manualClose) {
          try {
            onStatus?.({ state: "closed", room: r });
          } catch {}
          return;
        }
        // backoff y reintento
        attempt++;
        const delay = jitter(
          clamp(
            BACKOFF.base * Math.pow(BACKOFF.factor, attempt - 1),
            BACKOFF.base,
            BACKOFF.max
          )
        );
        try {
          onStatus?.({
            state: "retrying",
            room: r,
            attempt,
            delayMs: delay,
          });
        } catch {}
        setTimeout(() => {
          if (!manualClose) connectLoop();
        }, delay);
      };

      // salimos del bucle; el resto se maneja en callbacks
      break;
    }
  }

  // Arrancar conexión
  connectLoop();

  return {
    send(obj) {
      if (!ws || ws.readyState !== 1 /* OPEN */) return;
      try {
        ws.send(JSON.stringify(obj));
      } catch {}
    },
    close() {
      manualClose = true;
      try {
        ws?.close();
      } catch {}
    },
  };
}

// -------------------------------------------------
// Factory pública
// -------------------------------------------------
export function createTransport(kind, room, onMessage, onStatus, opts = {}) {
  if (kind === "bc") {
    // Antes usábamos BroadcastChannel directamente.
    // Ahora permitimos forzar WS (por ejemplo, para chat) aunque el modo sea "bc".
    const useWSForChat = opts.forceWSForChat;
    if (useWSForChat) {
      // Reutilizamos el transporte WS, respetando opts.wsUrl si viene.
      return createWSTransport(room, onMessage, onStatus, opts);
    }
    return createBCTransport(room, onMessage, onStatus);
  }

  if (kind === "ws") {
    // opts: { wsUrl, ... }
    return createWSTransport(room, onMessage, onStatus, opts);
  }

  console.warn("[transport] kind desconocido:", kind);
  return { send() {}, close() {} };
}
