// ===============================================
// src/ui/pages/Online/lib/chat.controller.js
// Controlador de CHAT DE TEXTO para modo Online
// -----------------------------------------------
// No habla directamente con WebSocket.
// Recibe un callback `sendSignal(payload)` y tú decides
// en mountOnline.js cómo envolverlo en { t:"ui", op:"chat", payload }.
// ===============================================

/**
 * @typedef {Object} ChatMessage
 * @property {"me"|"remote"} from
 * @property {string} text
 * @property {number} ts   // timestamp (ms)
 * @property {"text"|"quick"} [kind]
 */

/**
 * @param {Object} opts
 * @param {(payload: any) => void} opts.sendSignal  // se llama al enviar algo
 * @param {(...args:any[]) => void} [opts.log]
 */
export function createChatController({ sendSignal, log = () => {} }) {
  // Identificador por sala → evita mezclar frases entre rooms
  const roomName = String(location.pathname + location.search);

  const LS_KEY = "d10_chat_phrases_" + roomName;
  const LS_USE = "d10_chat_uses_" + roomName;

  // --------------------------
  // FRASES PREDETERMINADAS BASE
  // --------------------------
  const defaultPhrases = [
    "Juega rápido",
    "Estás demorando",
    "Buena jugada",
    "Un momento",
    "Estoy listo",
  ];

  // CARGAR FRASES PERSONALIZADAS
  /** @type {string[]} */
  let customPhrases = [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) customPhrases = JSON.parse(raw);
  } catch (e) {
    log("[CHAT] Error leyendo LS_KEY:", e);
  }

  // USO DE FRASES (para ordenar por uso)
  /** @type {Record<string, number>} */
  let usage = {};
  try {
    const raw = localStorage.getItem(LS_USE);
    if (raw) usage = JSON.parse(raw);
  } catch (e) {
    log("[CHAT] Error leyendo LS_USE:", e);
  }

  // MERGE DE TODAS LAS FRASES Y ORDEN POR USO
  function getMergedPhrases() {
    const merged = [...defaultPhrases, ...customPhrases];
    return merged.sort((a, b) => {
      const ua = usage[a] || 0;
      const ub = usage[b] || 0;
      return ub - ua;
    });
  }

  // --------------------------
  // ESTADO PRINCIPAL
  // --------------------------
  let state = {
    isOpen: false, // inicia cerrado
    unread: 0,
    /** @type {ChatMessage[]} */
    messages: [],
    quickPhrases: getMergedPhrases(),
  };

  /** @type {Array<(s: typeof state) => void>} */
  const subscribers = [];

  function notify() {
    for (const fn of subscribers) {
      try {
        fn(state);
      } catch {}
    }
  }

  function getSnapshot() {
    return state;
  }

  // --------------------------
  // SUSCRIPCIÓN
  // --------------------------
  function subscribe(fn) {
    subscribers.push(fn);
    try {
      fn(state);
    } catch {}
    return () => {
      const idx = subscribers.indexOf(fn);
      if (idx >= 0) subscribers.splice(idx, 1);
    };
  }

  // --------------------------
  // ABRIR / CERRAR
  // --------------------------
  function open() {
    state.isOpen = true;
    state.unread = 0;
    notify();
  }

  function close() {
    state.isOpen = false;
    notify();
  }

  function toggle() {
    state.isOpen = !state.isOpen;
    if (state.isOpen) state.unread = 0;
    notify();
  }

  // --------------------------
  // ENVIAR TEXTO NORMAL
  // --------------------------
  function sendText(text) {
    if (!text) return;
    const clean = String(text).trim();
    if (!clean) return;

    /** @type {ChatMessage} */
    const msg = {
      from: "me",
      text: clean,
      ts: Date.now(),
      kind: "text",
    };

    state.messages.push(msg);
    notify();

    // Enviar por red
    sendSignal({
      type: "text",
      text: msg.text,
      ts: msg.ts,
      kind: "text",
    });
  }

  // --------------------------
  // RECIBIR MENSAJE REMOTO
  // --------------------------
  function handleSignalMessage(payload) {
    if (!payload || typeof payload !== "object") return;

    const text = (payload.text || "").toString();
    const clean = text.trim();
    if (!clean) return;

    const ts = typeof payload.ts === "number" ? payload.ts : Date.now();
    const kind = payload.kind === "quick" ? "quick" : "text";

    /** @type {ChatMessage} */
    const remoteMsg = {
      from: "remote",
      text: clean,
      ts,
      kind,
    };

    state.messages.push(remoteMsg);

    if (!state.isOpen) {
      state.unread += 1;
    }

    // 🔔 Sonar SOLO cuando llega un mensaje real
    try {
      playIncomingSound();
    } catch {}

    notify();
  }

  // --------------------------
  // ENVIAR FRASE RÁPIDA
  // --------------------------
  function sendQuickPhrase(index) {
    const phrases = state.quickPhrases || [];
    if (!phrases[index]) return;

    const text = phrases[index];

    // Registrar uso para ordenar por frecuencia
    usage[text] = (usage[text] || 0) + 1;
    try {
      localStorage.setItem(LS_USE, JSON.stringify(usage));
    } catch {}

    state.quickPhrases = getMergedPhrases();

    const clean = text.trim();
    if (!clean) return;

    /** @type {ChatMessage} */
    const msg = {
      from: "me",
      text: clean,
      ts: Date.now(),
      kind: "quick",
    };

    state.messages.push(msg);
    notify();

    sendSignal({
      type: "text",
      text: msg.text,
      ts: msg.ts,
      kind: "quick",
    });
  }

  // --------------------------
  // AÑADIR FRASE PERSONALIZADA
  // --------------------------
  function addCustomPhrase(text) {
    const clean = String(text || "").trim();
    if (!clean) return;

    if (!customPhrases.includes(clean) && !defaultPhrases.includes(clean)) {
      customPhrases.push(clean);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(customPhrases));
      } catch {}
    }

    // Inicializar contador de uso si no existe
    if (!usage[clean]) usage[clean] = 0;
    try {
      localStorage.setItem(LS_USE, JSON.stringify(usage));
    } catch {}

    state.quickPhrases = getMergedPhrases();
    notify();
  }

  // --------------------------
  // ELIMINAR FRASE PERSONALIZADA
  // --------------------------
  function removeCustomPhrase(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    if (!customPhrases.includes(clean)) return;

    customPhrases = customPhrases.filter((t) => t !== clean);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(customPhrases));
    } catch {}

    // También borramos su contador de uso
    if (usage[clean] != null) {
      delete usage[clean];
      try {
        localStorage.setItem(LS_USE, JSON.stringify(usage));
      } catch {}
    }

    state.quickPhrases = getMergedPhrases();
    notify();
  }

  function isCustomPhrase(text) {
    const clean = String(text || "").trim();
    return customPhrases.includes(clean);
  }

  // --------------------------
  // SONIDO DE ENTRADA
  // --------------------------
  // Reutilizamos un único <audio> para evitar recrearlo
  let audioEl = null;

  function ensureAudio() {
    if (!audioEl) {
      // Ruta relativa a /public → public/sonidos/mensaje-iphone.mp3
      audioEl = new Audio("sonidos/mensaje-iphone.mp3");
      audioEl.preload = "auto";
    }
    return audioEl;
  }

  // Sonido cuando llega un mensaje nuevo
  function playIncomingSound() {
    try {
      const a = ensureAudio();
      a.pause();
      a.currentTime = 0;
      a.volume = 0.9; // volumen normal
      a.play().catch((e) => {
        console.warn("[CHAT] No se pudo reproducir el audio del mensaje:", e);
      });
    } catch (e) {
      console.warn("[CHAT] Error al intentar reproducir el audio:", e);
    }
  }

  // Desbloquear audio sin que se escuche nada
  function primeSound() {
    try {
      const a = ensureAudio();
      a.pause();
      a.currentTime = 0;
      const prevVol = a.volume;
      a.volume = 0; // 🔇 reproducción en silencio

      a.play()
        .then(() => {
          // Pausamos enseguida y restauramos volumen
          setTimeout(() => {
            try {
              a.pause();
              a.currentTime = 0;
              a.volume = prevVol;
            } catch {}
          }, 50);
        })
        .catch(() => {
          // si falla, no pasa nada; solo era para desbloquear
        });
    } catch (e) {
      console.warn("[CHAT] primeSound error:", e);
    }
  }

  // --------------------------
  // API PÚBLICA
  // --------------------------
  return {
    // lectura
    getState: getSnapshot,
    getQuickPhrases: () => state.quickPhrases.slice(),

    // apertura / cierre
    open,
    close,
    toggle,

    // acciones chat
    sendText,
    sendQuickPhrase,
    handleSignalMessage,

    // manejo de frases personalizadas
    addCustomPhrase,
    removeCustomPhrase,
    isCustomPhrase,

    // suscripción
    subscribe,

    // test / primado de sonido
    primeSound,
  };
}
