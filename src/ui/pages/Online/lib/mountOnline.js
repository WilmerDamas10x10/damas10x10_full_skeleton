// ================================
// src/ui/pages/Online/lib/mountOnline.js
// Online — Unimotor con transporte seleccionable: BroadcastChannel o WebSocket
// Sincronización robusta (snapshot t:"state" + hash) y validación prevH/nextH.
// Color local por URL: /online?me=R | N | S (S = espectador)
// Auto-asignación de lado por sala (peers/handshake) con fallback por dispositivo.
// Panel DEBUG gateado. Toolbar opcional (carga dinámica). Replay asistido.
// Botón “Rotar tablero” con persistencia por sala/dispositivo.
// WebRTC: video/audio con dos <video> (local + remoto).
// Chat de texto plegable debajo de la cámara local.
// ================================

import {
  SIZE,
  dark,
  startBoard,
  drawBoard,
  clearHints,
  hintMove,
  showFirstStepOptions,
  markRouteLabel,
  paintState,
  makeController,
  attachBoardInteractions,
  COLOR,
  colorOf,
  movimientos as baseMovimientos,
  aplicarMovimiento as baseAplicarMovimiento,
} from "@engine"; // ← motor único

import { onMove, onCaptureHop, onCrown } from "../../../sfx.hooks.js";
import { initEditorSFX } from "../../Training/editor/sfx.bootstrap.js";
import { ensureGlobalFX } from "../../../kit/globalFX.js";

import { installGoldenHook } from "../../Training/editor/dev/goldenHook.js";

import "../../../../styles/board.css";
import "../../../../styles/board/cells.css";

// 🎨 Estilos locales del modo Online
import "../online.styles.css";
import "../turn.halo.js";

// Secuencias y replay
import { setupSeqReplay } from "./seqReplay.js";

// Banner espectador
import "./spectatorBanner.css";

// Overlay para desbloquear audio
import { createSFXUnlockOverlay } from "./sfxUnlock.js";
import "./sfxUnlock.css";

let ATTACH_TOOLBAR_PROMISE = null;
const EDITOR_TOOLBAR_ENABLED = false;

// Helpers
import {
  clone,
  last,
  routeHasCapture,
  crownIfNeeded,
  scrubNonPlayableSquares,
  cellChar,
  sanitizeBoard,
  stateHash,
} from "./helpers.js";

import { createTransport, PROTO_V } from "./transport.js";
import { createSyncMonitor } from "./sync.js";
import { getOnlineLayoutHTML } from "../ui.layout.js";
import {
  setupOnlineButtons,
  setupDrawAndResignButtons,
} from "../ui.buttons.js";
import { setupMediaButtons } from "../ui.mediaButtons.js";
import { createRTCController } from "./rtc.controller.js";
import { getDebugPanelHTML, setupDebugPanel } from "../ui.debug.js";
// ✅ Reutilizamos helpers de depuración ya existentes
import { boardToAscii as boardToAsciiDebug } from "./debug.js";

// 🆕 Chat de texto
import { createChatController } from "./chat.controller.js";
import { mountOnlineChatPanel } from "../ui/chat.panel.js";

// 🆕 Halo remoto/local modularizado
import { createRemoteSelectionHighlighter } from "../ui.selection.js";

// --- Utils locales ---
const sanitizeRoom = (s) =>
  String(s || "sala1").trim().toLowerCase().replace(/\s+/g, "").slice(0, 48);

const orientKey = (room) => `D10_ORIENT_FLIP:${sanitizeRoom(room || "sala1")}`;
const loadOrientFlip = (room) =>
  localStorage.getItem(orientKey(room)) === "1";
const saveOrientFlip = (room, val) => {
  try {
    localStorage.setItem(orientKey(room), val ? "1" : "0");
  } catch {}
};

let currentRoom = null; // sala actual

function isValidMovePayload(p) {
  const isPair = (a) =>
    Array.isArray(a) && a.length === 2 && a.every(Number.isFinite);
  if (!p || typeof p !== "object") return false;
  if (p.type === "move") return isPair(p.from) && isPair(p.to);
  if (p.type === "capture")
    return (
      Array.isArray(p.path) &&
      p.path.length >= 2 &&
      p.path.every(isPair)
    );
  return false;
}

export default function mountOnline(container) {
  if (!container) return;

  ensureGlobalFX();
  initEditorSFX();

  // Declaramos aquí para usarlo más abajo (BC/WS)
  let removeSFXUnlock = null;

  // ==== Flags de entorno (GOLDEN/DEBUG) ====
  const DEV_QUERY = /[?&]dev=1\b/i.test(location.search);
  const GOLDEN_ENABLED =
    DEV_QUERY ||
    /[?&]golden=1\b/i.test(location.search) ||
    localStorage.getItem("D10_GOLDEN") === "1";
  const DEBUG_ENABLED =
    DEV_QUERY ||
    /[?&]debug=1\b/i.test(location.search) ||
    localStorage.getItem("D10_DEBUG") === "1";

  // Panel DEBUG gateado (HTML viene de módulo externo)
  const DEBUG_PANEL_HTML = getDebugPanelHTML(DEBUG_ENABLED);

  // === Render del layout HTML ===
  container.innerHTML = getOnlineLayoutHTML(DEBUG_PANEL_HTML);

  // ===== Identidad del cliente (anti-eco)
  const CLIENT_ID = Math.random().toString(36).slice(2);
  let applyingRemote = false;

  // ===== Estado base
  let board = sanitizeBoard(startBoard());
  let turn = COLOR.ROJO; // ROJO inicia
  let stepState = null;

  // URL params
  const urlParams = new URLSearchParams(location.search);
  const meParamRaw = (urlParams.get("me") || "").trim();
  const meParam = meParamRaw.toUpperCase();
  const explicitSide =
    meParam === "R"
      ? COLOR.ROJO
      : meParam === "N"
      ? COLOR.NEGRO
      : null;
  const isSpectator = meParam === "S";

  // Lado local (puede cambiar por auto-assign / handshake)
  let localSide = explicitSide != null ? explicitSide : COLOR.ROJO;
  // Solo ROJO inicia WebRTC (si no es espectador)
  let isCallInitiator = !isSpectator && localSide === COLOR.ROJO;

  // Sala inicial por URL (antes de conectar)
  const urlNet = (urlParams.get("net") || "").trim().toLowerCase(); // 'bc' | 'ws'
  const urlRoom = sanitizeRoom(urlParams.get("room") || "sala1");
  const urlWs = (urlParams.get("ws") || "").trim();

  // 🚀 Default de producción en Render:
  const PROD_WS = "wss://wilmerchdamas10x10-ws.onrender.com";

  // Para mantener pruebas locales funcionando, si el host es local/LAN
  // seguimos usando ws(s)://<host>:3001; en caso contrario usamos PROD_WS.
  const urlHost = (urlParams.get("host") || location.hostname || "localhost").trim();
  const isLocalHost = /^(localhost|127\.0\.0\.1|(?:\d{1,3}\.){3}\d{1,3})$/i.test(
    urlHost
  );

  const DEFAULT_WS = isLocalHost
    ? location.protocol === "https:"
      ? `wss://${urlHost}:3001`
      : `ws://${urlHost}:3001`
    : PROD_WS;

  // Si viene ?ws=... en la URL, respétalo; si no, usa DEFAULT_WS
  const WS_URL_FOR_QUERY = urlWs || DEFAULT_WS;

  // Orientación (flip) persistida por sala/dispositivo
  let flipOrientation = loadOrientFlip(urlRoom);

  // ==== Presencia / seating determinístico por sala ====
  const peerIds = new Set(); // ids vistos en la sala (incluye el mío)
  peerIds.add(CLIENT_ID);
  let seatingAppliedOnce = false;

  function announcePresence() {
    // se reenvía por el transporte actual (WS o BC)
    netSend({ t: "presence", clientId: CLIENT_ID, ts: Date.now() });
  }

  // Ordena por id y asigna lado: 0 -> ROJO, 1 -> NEGRO
  function recomputeSideFromPeers() {
    if (explicitSide != null || isSpectator) return; // ?me= manda
    const ids = Array.from(peerIds).sort();
    const idx = ids.indexOf(CLIENT_ID);
    if (idx === 0) {
      localSide = COLOR.ROJO;
    } else if (idx === 1) {
      localSide = COLOR.NEGRO;
    }

    // Actualizar quién puede iniciar la llamada RTC
    isCallInitiator = !isSpectator && localSide === COLOR.ROJO;

    seatingAppliedOnce = true;
    setTurnText();
    updateLock();
    render(); // asegura que la orientación visual se actualice
  }

  // Edición mínima (Toolbar)
  let placing = null; // 'x','r','n','R','N' o null
  const undoStack = [];

  // ===== Monitor de sync (UI + validaciones hash)
  const syncMon = createSyncMonitor({
    getBoard: () => board,
    getTurn: () => turn,
    updateUI: (ok) => {
      void ok;
    },
  });

  // === Métricas (HUD) — sin UI visible (solo hook interno)
  function updateMetricsUI() {
    const m =
      syncMon.getMetrics?.() || {
        sent: 0,
        recv: 0,
        valid: 0,
        invalid: 0,
      };
    void m;
  }
  syncMon.onMetrics?.(updateMetricsUI);

  // ===== Captura obligatoria
  function anyCaptureAvailableFor(color) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const ch = board[r][c];
        if (!ch || colorOf(ch) !== color) continue;
        const mv = baseMovimientos(board, [r, c]) || {};
        const caps = mv.captures || mv.capturas || mv.takes || [];
        if (Array.isArray(caps) && caps.length) return true;
      }
    }
    return false;
  }
  function filterByMustCapture(result, must) {
    if (!must) return result;
    if (Array.isArray(result)) return result.filter(routeHasCapture);
    if (result && typeof result === "object") {
      const caps = result.captures || result.capturas || result.takes || [];
      return {
        ...result,
        captures: caps,
        capturas: caps,
        takes: caps,
        moves: [],
        movs: [],
      };
    }
    return result;
  }
  const movimientosForced = (...args) => {
    const res = baseMovimientos(...args) || {};
    const must = anyCaptureAvailableFor(turn);
    return filterByMustCapture(res, must);
  };

  const aplicarMovimientoForced = (b, payload) => {
    const isCapture = (() => {
      if (!payload) return false;
      if (Array.isArray(payload?.path) && payload.path.length >= 2)
        return true;
      if (payload?.from && payload?.to) {
        const [fr, fc] = payload.from;
        const [tr, tc] = payload.to;
        if (Math.abs(fr - tr) >= 2 || Math.abs(fc - tc) >= 2) return true;
      }
      return false;
    })();
    const must = anyCaptureAvailableFor(turn);
    if (must && !isCapture) return b;

    const nb = baseAplicarMovimiento(b, payload);
    try {
      const crownTo =
        payload?.to ||
        (Array.isArray(payload?.path) ? last(payload.path) : null);
      crownIfNeeded(nb, crownTo);
    } catch {}
    return nb;
  };

  // ===== Transporte (BC/WS)
  let transport = null;
  let rtc = null;

  // 🌐 Estado de red (para bloquear movimientos cuando WS no está estable)
  let netMode = "none"; // "bc" | "ws" | "none"
  let wsState = "closed"; // último estado reportado por createTransport("ws")

  function closeTransport() {
    try {
      transport?.close?.();
    } catch {}
    transport = null;
    netMode = "none";
    wsState = "closed";
  }

  // 🔒 Helpers para limpiar también WebRTC (cámara/mic/PC)
  function stopRTC() {
    try {
      rtc?.stopAll?.();
    } catch {}
  }

  function closeRealtime() {
    // Cierra transporte (BC/WS) y cualquier llamada RTC activa
    closeTransport();
    stopRTC();
  }

  function netSend(obj) {
    try {
      transport?.send?.({
        ...obj,
        v: PROTO_V,
        room: currentRoom,
        clientId: CLIENT_ID,
      });
    } catch {}
    syncMon.onNetSent?.(1);
    updateMetricsUI();
  }
  function netSendState() {
    const h = stateHash(board, turn);
    netSend({ t: "state", board: sanitizeBoard(board), turn, h });
  }

  // === Refs DOM (después de renderizar layout) ===
  const $board = container.querySelector("#board");
  const $turnInfo = container.querySelector("#turn-info");
  const $btnBack = container.querySelector("#btn-back");
  const $btnRestart = container.querySelector("#btn-restart");
  const $btnRotate = container.querySelector("#btn-rotate");
  const $roomInput = container.querySelector("#room-id");
  const $btnConnect = container.querySelector("#btn-connect");
  const $bcStatus = container.querySelector("#bc-status");
  const $wsUrl = container.querySelector("#ws-url");
  const $wsRoom = container.querySelector("#ws-room");
  const $btnWSConn = container.querySelector("#btn-ws-connect");
  const $wsStatus = container.querySelector("#ws-status");

  // ================================
  // 🟢 Enviar selección al otro lado (solo envío)
  // ================================
  if ($board) {
    $board.addEventListener("pointerdown", (ev) => {
      try {
        const cell = ev.target.closest("[data-r][data-c]");
        if (!cell || !$board.contains(cell)) return;

        const rAttr = cell.getAttribute("data-r");
        const cAttr = cell.getAttribute("data-c");
        if (rAttr == null || cAttr == null) return;

        const r = Number(rAttr);
        const c = Number(cAttr);
        if (!Number.isInteger(r) || !Number.isInteger(c)) return;

        const piece = cell.querySelector(".piece");
        if (!piece) return;

        const pos = [r, c];
        netSend({
          t: "ui",
          op: "select",
          pos,
        });

        console.log("[Online] select SEND (pointerdown)", pos);
      } catch (e) {
        console.warn("[Online] Error enviando select remoto:", e);
      }
    });
  }

  // 🎥 Refs para video local y remoto
  const $videoLocal = container.querySelector("#video-local");
  const $videoRemote = container.querySelector("#video-remote");

  // Crear controlador RTC (señalización + streams)
  rtc = createRTCController({
    sendSignal: (payload) => {
      // Enviamos por la red usando el canal estándar t:"ui"/op:"rtc"
      netSend({
        t: "ui",
        op: "rtc",
        payload,
      });
    },

    // 🟢 LOCAL: siempre en mudo, solo preview
    onLocalStream: (stream) => {
      console.log(
        "[RTC] onLocalStream (preview local, mute), tracks:",
        stream?.getTracks?.().length ?? 0
      );

      if (!$videoLocal) return;

      if (stream) {
        $videoLocal.srcObject = stream;
        $videoLocal.style.display = "block";

        $videoLocal.muted = true; // nunca escuchas tu propio audio
        $videoLocal.volume = 0;
        $videoLocal.playsInline = true;
        $videoLocal.autoplay = true;

        try {
          const p = $videoLocal.play();
          if (p && typeof p.then === "function") {
            p.catch(() => {});
          }
        } catch {}
      } else {
        $videoLocal.srcObject = null;
        $videoLocal.style.display = "none";
      }
    },

    // 🔊 REMOTO: aquí debe escucharse el rival
    onRemoteStream: (stream) => {
      console.log(
        "[RTC] onRemoteStream (rival con audio), tracks:",
        stream?.getTracks?.().length ?? 0
      );

      if (!$videoRemote) return;

      if (stream) {
        $videoRemote.srcObject = stream;
        $videoRemote.style.display = "block";

        // Importante: el remoto NO va muteado
        $videoRemote.muted = false;
        $videoRemote.volume = 1;
        $videoRemote.playsInline = true;
        $videoRemote.autoplay = true;

        try {
          const p = $videoRemote.play();
          if (p && typeof p.then === "function") {
            p.catch(() => {});
          }
        } catch {}
      } else {
        $videoRemote.srcObject = null;
        $videoRemote.style.display = "none";
      }
    },

    log: (...args) => console.log("[RTC]", ...args),
  });

  // 🆕 CHAT: controlador de chat de texto (usa el mismo transporte netSend)
  const chatController = createChatController({
    sendSignal: (payload) => {
      // op:"chat" para distinguirlo de rtc, restart, etc.
      netSend({
        t: "ui",
        op: "chat",
        payload,
      });
    },
    log: (...args) => console.log("[CHAT]", ...args),
  });

  // Montar la ventanita de chat en la columna WS (derecha),
  // arriba del primer control (WS URL)
  const wsColumn = container.querySelector(".online-column--ws") || container;

  if (wsColumn) {
    const chatMount = document.createElement("div");
    chatMount.id = "online-chat-right";
    chatMount.style.marginBottom = "8px";

    const firstChild = wsColumn.firstElementChild;
    if (firstChild) {
      wsColumn.insertBefore(chatMount, firstChild);
    } else {
      wsColumn.appendChild(chatMount);
    }

    mountOnlineChatPanel({
      rootElement: chatMount,
      controller: chatController,
    });
  }

  // ——— Overlay de desbloqueo de audio
  removeSFXUnlock = createSFXUnlockOverlay({
    onUnlocked: () => {
      // Desbloquea SFX del juego
      try {
        initEditorSFX();
      } catch {}

      // 🔔 Desbloquea también el sonido del chat
      try {
        if (chatController && typeof chatController.primeSound === "function") {
          chatController.primeSound();
        }
      } catch {}
    },
  });

  // ========================================
  // ACTIVAR BOTONES DE CÁMARA / MICRÓFONO
  // ========================================
  setupMediaButtons({
    container,
    rtc,
    getIsCallInitiator: () => isCallInitiator,
  });

  if ($wsUrl) $wsUrl.value = WS_URL_FOR_QUERY;

  // Helpers DEBUG (texto <-> tablero) — usamos debug.js
  const boardToAscii = (b) => boardToAsciiDebug(b, cellChar);
  function countPieces(b) {
    let r = 0,
      n = 0,
      R = 0,
      N = 0;
    for (let i = 0; i < SIZE; i++) {
      const row = b?.[i] || [];
      for (let j = 0; j < SIZE; j++) {
        const v = row[j];
        if (v === "r") r++;
        else if (v === "n") n++;
        else if (v === "R") R++;
        else if (v === "N") N++;
      }
    }
    return { r, n, R, N, total: r + n + R + N };
  }

  // ===== Conectividad (labels)
  function handleBCStatus(s) {
    if (!$bcStatus) return;

    if (s.state === "unsupported") {
      $bcStatus.textContent = "BC: No soportado";
      return;
    }

    if (s.state === "closed") {
      $bcStatus.textContent = "BC: Cerrado";
      return;
    }

    if (s.state === "open") {
      const peers = Math.max(0, s.peers ?? 0);
      $bcStatus.textContent = `BC: Conectado (${s.room}) · pares: ${peers}`;
      // BC no garantiza 'peers' por mensaje; si no hay ?me=, aplica fallback dispositivo
      autoAssignSide({ peers }); // usa peers si viene, sino usa device fallback internamente
      setTurnText();
      updateLock();
      return;
    }

    // Otros estados (inicial, conectando, etc.)
    $bcStatus.textContent = "BC: …";
  }

  function handleWSStatus(s) {
    wsState = s?.state || wsState;
    const base = "WS" + (s.room ? `:${s.room}` : "");

    // 🔵 Actualizar texto del chip de estado (derecha)
    if ($wsStatus) {
      if (s.state === "connecting") {
        $wsStatus.textContent = `${base}: Conectando…`;
      } else if (s.state === "open") {
        $wsStatus.textContent = `${base}: Conectado`;
      } else if (s.state === "retrying") {
        $wsStatus.textContent = `${base}: Reintentando…`;
      } else if (s.state === "error") {
        $wsStatus.textContent = `${base}: Error`;
      } else if (s.state === "closed") {
        $wsStatus.textContent = `${base}: Cerrado`;
      } else {
        $wsStatus.textContent = `${base}: …`;
      }
    }

    // 🟢 Actualizar color y texto del botón "Conectar WS"
    if ($btnWSConn) {
      if (s.state === "connecting" || s.state === "retrying") {
        $btnWSConn.classList.remove("online-btn--connected");
        $btnWSConn.classList.add("online-btn--disconnected");
        $btnWSConn.textContent = "Conectando…";
      } else if (s.state === "open") {
        $btnWSConn.classList.remove("online-btn--disconnected");
        $btnWSConn.classList.add("online-btn--connected");
        $btnWSConn.textContent = "Conectado";
        // ✅ En lugar de imponer nuestro tablero, pedimos el estado a la sala
        netSend({ t: "state_req" });
        // Anuncia presencia cuando el socket ya está abierto
        announcePresence();
      } else if (s.state === "error" || s.state === "closed") {
        $btnWSConn.classList.remove("online-btn--connected");
        $btnWSConn.classList.add("online-btn--disconnected");
        $btnWSConn.textContent = "Conectar WS";
      }
    }

    // Actualizar bloqueo de tablero según estado WS
    updateLock();

    if (
      s.state === "open" ||
      s.state === "connecting" ||
      s.state === "retrying" ||
      s.state === "error" ||
      s.state === "closed"
    ) {
      return;
    }
  }

  // ===== Bus de mensajes para seqReplay (nombres únicos para evitar colisiones)
  const _seqBus = {
    listeners: [],
    on(fn) {
      if (typeof fn === "function") this.listeners.push(fn);
    },
    emit(msg) {
      for (const fn of this.listeners) {
        try {
          fn(msg);
        } catch {}
      }
    },
  };
  const netIface = {
    send: (obj) => netSend(obj),
    onMessage: (fn) => _seqBus.on(fn),
  };
  let seqCtl = null;

  function connectBC(name) {
    closeRealtime();
    const room = sanitizeRoom(name || "sala1");
    currentRoom = room;

    // BC: la red está disponible mientras el canal exista
    netMode = "bc";
    wsState = "open";

    // Cargar orientación persistida al entrar a esta sala
    flipOrientation = loadOrientFlip(currentRoom);
    updateOrientButton();
    render();

    const t = createTransport("bc", room, handleNetMessage, handleBCStatus);
    transport = t;

    // join explícito
    t.send({ t: "join", v: PROTO_V, room, clientId: CLIENT_ID });

    // ✅ No imponemos nuestro estado inicial; pedimos el snapshot a otros pares
    netSend({ t: "state_req" });

    try {
      seqCtl?.dispose?.();
    } catch {}
    seqCtl = setupSeqReplay(netIface, currentRoom, { log: false });

    // Anuncia presencia en BC inmediatamente
    announcePresence();

    // Si no hay ?me=, aplica fallback ahora mismo (por si no llega 'peers')
    autoAssignSide();
    setTurnText();
    updateLock();
  }

  function connectWS(url, room) {
    closeRealtime();
    const safeRoom = sanitizeRoom(room || "sala1");
    currentRoom = safeRoom;

    // WS: empezamos en modo "connecting" hasta que handleWSStatus diga "open"
    netMode = "ws";
    wsState = "connecting";

    // Cargar orientación persistida al entrar a esta sala
    flipOrientation = loadOrientFlip(currentRoom);
    updateOrientButton();
    render();

    transport = createTransport(
      "ws",
      safeRoom,
      handleNetMessage,
      handleWSStatus,
      { wsUrl: url || DEFAULT_WS }
    );

    try {
      seqCtl?.dispose?.();
    } catch {}
    seqCtl = setupSeqReplay(netIface, currentRoom, { log: false });
    // Para WS, el announcePresence se hace al abrir (handleWSStatus -> 'open')
  }

  // ===== Render helpers
  function shouldShowNegroBottom() {
    // Auto: negras abajo si yo soy NEGRO. Si flipOrientation true => invertimos.
    const autoNegro = localSide === COLOR.NEGRO;
    return flipOrientation ? !autoNegro : autoNegro;
  }

  function render() {
    if (shouldShowNegroBottom()) $board.classList.add("view-negro");
    else $board.classList.remove("view-negro");
    drawBoard($board, board, SIZE, dark);
  }

  function setTurnText() {
    const myTxt = isSpectator
      ? "ESPECTADOR"
      : localSide === COLOR.ROJO
      ? "ROJO"
      : "NEGRO";
    const $ti = $turnInfo;
    if ($ti)
      $ti.textContent = `Turno: ${
        turn === COLOR.ROJO ? "ROJO" : "NEGRO"
      } · Tú: ${myTxt}`;
  }

  function updateLock() {
    // ⛔ Si estamos en WS y NO está 'open', bloqueamos movimientos
    const wsBlocked =
      netMode === "ws" &&
      wsState !== "open";

    const myTurn =
      turn === localSide &&
      !applyingRemote &&
      !isSpectator &&
      !wsBlocked;

    if ($board) {
      $board.style.pointerEvents = myTurn ? "auto" : "none";
      $board.style.opacity = myTurn ? "1" : "0.9";
      $board.style.filter = myTurn ? "" : "grayscale(.05)";
    }
  }

  // ===== Auto-asignación de lado =====
  function deviceLooksHandheld() {
    const coarse = (() => {
      try {
        return (
          window.matchMedia &&
          matchMedia("(pointer:coarse)").matches
        );
      } catch {
        return false;
      }
    })();
    const ua = navigator.userAgent || "";
    const mobi = /Mobi|Android|iPhone|iPad|iPod|GoogleTV|Android TV/i.test(
      ua
    );
    return coarse || mobi;
  }
  function autoAssignSide(hint) {
    if (explicitSide != null || isSpectator) return; // ?me= manda
    if (hint && Number.isFinite(hint.peers)) {
      // 1º = ROJO, 2º = NEGRO
      localSide = hint.peers % 2 === 1 ? COLOR.ROJO : COLOR.NEGRO;
      // Actualizar quién puede iniciar la llamada RTC
      isCallInitiator = !isSpectator && localSide === COLOR.ROJO;
      return;
    }
    // Fallback por dispositivo
    localSide = deviceLooksHandheld() ? COLOR.NEGRO : COLOR.ROJO;
    // Actualizar quién puede iniciar la llamada RTC
    isCallInitiator = !isSpectator && localSide === COLOR.ROJO;
  }

  // ===== Ctx unimotor
  const movimientos = movimientosForced;
  const aplicarMovimiento = aplicarMovimientoForced;

  const base_setBoard = (b) => {
    board = b;
  };
  const base_getBoard = () => board;

  const baseCtx = {
    SIZE,
    container,
    getBoard: base_getBoard,
    setBoard: base_setBoard,
    getTurn: () => turn,
    setTurn: (t) => {
      turn = t;
      setTurnText();
      updateLock();
      if (!applyingRemote) netSendState();
    },

    getStepState: () => stepState,
    setStepState: (s) => {
      stepState = s;
    },

    getPlacing: () => placing,

    render,
    paintState: () =>
      paintState({
        boardEl: $board,
        board,
        turn,
        setTurn: (t) => {
          turn = t;
          setTurnText();
          updateLock();
          if (!applyingRemote) netSendState();
        },
        stepState,
        setStepState: (s) => {
          stepState = s;
        },
        container,
        showDebug: false,
      }),

    saveForUndo: () => {
      undoStack.push(clone(board));
      if (undoStack.length > 100) undoStack.shift();
    },

    rules: { colorOf, movimientos, aplicarMovimiento },
    deps: { movimientos, aplicarMovimiento, rules: { colorOf } },
    hints: {
      clearHints,
      hintMove,
      showFirstStepOptions,
      markRouteLabel,
    },

    onTurnChange: () => {
      setTurnText();
      updateLock();
    },
  };

  // Helper para reinicio duro (usado por handshake y por empate/rendición)
  function hardRestart() {
    board = sanitizeBoard(startBoard());
    stepState = null;
    turn = COLOR.ROJO;
    undoStack.length = 0;
    render();
    baseCtx.paintState();
    setTurnText();
    updateLock();
    netSendState();
    syncMon.onLocalChange?.();
  }

  // Controller
  const controller = makeController({
    container,
    getBoard: baseCtx.getBoard,
    setBoard: baseCtx.setBoard,
    getTurn: baseCtx.getTurn,
    setTurn: baseCtx.setTurn,
    getStepState: baseCtx.getStepState,
    setStepState: baseCtx.setStepState,
    getPlacing: baseCtx.getPlacing,
    render: baseCtx.render,
    paintState: baseCtx.paintState,
    deps: baseCtx.deps,
    hints: baseCtx.hints,
  });
  if (typeof controller.getPlacing !== "function") {
    controller.getPlacing = baseCtx.getPlacing;
  }

  // ===== Toolbar (carga dinámica opcional)
  const emptyBoard10x10 = () =>
    Array.from({ length: 10 }, () => Array(10).fill(""));
  const getPlacing = () =>
    typeof controller?.getPlacing === "function"
      ? controller.getPlacing()
      : placing;
  const setPlacing = (tool) => {
    placing = tool;
    try {
      controller.setPlacing?.(tool);
    } catch {}
  };
  const clearBoard = () => {
    const cleared = emptyBoard10x10();
    board = sanitizeBoard(cleared);
    controller.setBoard(board);
    render();
    baseCtx.paintState();
    netSendState();
    syncMon.onLocalChange?.();
  };
  const exitEdit = () => {
    setPlacing(null);
  };

  const boardCard = $board.parentElement || container;
  if (EDITOR_TOOLBAR_ENABLED) {
    if (!ATTACH_TOOLBAR_PROMISE) {
      ATTACH_TOOLBAR_PROMISE = import("./editorToolbar.js")
        .then((mod) => mod?.default || mod?.attachEditorToolbar || null)
        .catch(() => null);
    }
    ATTACH_TOOLBAR_PROMISE.then((fn) => {
      if (typeof fn === "function") {
        try {
          fn(boardCard, { getPlacing, setPlacing, clearBoard, exitEdit });
        } catch {}
      }
    });
  }

  // --- Sanitización de payloads
  function safeCell(p) {
    return (
      Array.isArray(p) &&
      p.length === 2 &&
      Number.isInteger(p[0]) &&
      Number.isInteger(p[1]) &&
      p[0] >= 0 &&
      p[1] >= 0 &&
      p[0] < SIZE &&
      p[1] < SIZE
    );
  }
  function safePath(path) {
    if (!Array.isArray(path) || path.length < 2) return null;
    const out = [];
    for (const p of path) {
      if (!safeCell(p)) return null;
      out.push([p[0] | 0, p[1] | 0]);
    }
    return out;
  }

  // 🆕 Highlighter remoto/local reutilizable
  const highlightSelected = createRemoteSelectionHighlighter({
    boardEl: $board,
    getBoard: () => board,
    colorOf,
    COLOR,
  });

  // ====== NUEVAS FUNCIONES AUXILIARES PARA MENSAJES REMOTOS ======

  function handleUIMessageFromNetwork(msg) {
    // Handshake de reinicio bilateral
    if (msg.op === "restart_req") {
      if (isSpectator) return;
      const accept = confirm(
        "El otro jugador quiere reiniciar la partida. ¿Aceptar?"
      );
      netSend({ t: "ui", op: "restart_ack", accepted: !!accept });
      if (accept) {
        hardRestart();
      }
      return;
    }

    if (msg.op === "restart_ack") {
      if (msg.accepted) {
        alert("El otro jugador aceptó. La partida se ha reiniciado.");
        hardRestart();
      } else {
        alert("El otro jugador rechazó el reinicio.");
      }
      return;
    }

    // 🔹 El rival propone EMPATE
    if (msg.op === "offer_draw") {
      if (isSpectator) return;

      const accept = confirm(
        "Tu rival propone EMPATE. ¿Aceptar tablas?"
      );
      netSend({
        t: "ui",
        op: "draw_response",
        accepted: !!accept,
      });

      if (accept) {
        // Sin alert extra: solo reinicio silencioso
        hardRestart();
      }
      return;
    }

    // 🔹 Respuesta a nuestra propuesta de EMPATE
    if (msg.op === "draw_response") {
      if (msg.accepted) {
        alert("El rival aceptó el empate. Comienza una nueva partida.");
        hardRestart();
      } else {
        alert("El rival rechazó el empate.");
      }
      return;
    }

    // 🔹 El rival se RINDE
    if (msg.op === "resign") {
      alert(
        "Tu rival se ha rendido. Has ganado la partida. Comienza una nueva partida."
      );
      hardRestart();
      return;
    }

    // 🟢 Aro de selección remoto
    if (msg.op === "select" && msg.pos) {
      console.log("[Online] select RECV", msg.pos);
      highlightSelected(msg.pos);
      return;
    }

    // 🆕 CHAT DE TEXTO
    if (msg.op === "chat" && msg.payload) {
      try {
        chatController.handleSignalMessage(msg.payload);
      } catch (e) {
        console.warn("[Online][CHAT] Error manejando mensaje:", e);
      }
      return;
    }

    // 🎥 Señalización WebRTC
    if (msg.op === "rtc" && msg.payload && rtc) {
      const payload = msg.payload;
      const kind = payload.kind;

      // Si llega una offer y ESTE lado NO es el iniciador, pedir confirmación
      if (kind === "offer" && !isCallInitiator) {
        const ok = confirm(
          "Tu rival quiere iniciar una videollamada. ¿Aceptar?"
        );
        if (!ok) {
          return;
        }
      }

      try {
        rtc.handleSignalMessage(payload);
      } catch (e) {
        console.warn("[Online][RTC] Error al manejar señal RTC:", e);
      }
    }
  }

  function applyRemoteStateFromNetwork(msg) {
    try {
      // ---- Diff SFX: comparamos el estado anterior vs el nuevo snapshot ----
      const prevBoard = board;
      const prevCounts = countPieces(prevBoard);
      const prevText = boardToAscii(prevBoard);

      const nextBoard = sanitizeBoard(msg.board);
      const nextCounts = countPieces(nextBoard);
      const nextText = boardToAscii(nextBoard);

      const moved = prevText !== nextText;
      const captured = prevCounts.total > nextCounts.total;
      const crownedR = nextCounts.R > prevCounts.R;
      const crownedN = nextCounts.N > prevCounts.N;
      const crowned = crownedR || crownedN;

      applyingRemote = true;
      try {
        board = nextBoard;
        turn = msg.turn;
        render();
        baseCtx.paintState();
        setTurnText();
        updateLock();
      } finally {
        applyingRemote = false;
        updateLock();
      }

      // Dispara SFX después de pintar (best-effort)
      if (moved) {
        try {
          if (captured) onCaptureHop();
          else onMove();
          if (crowned) onCrown();
        } catch {}
      }
    } catch (e) {
      console.warn("[Online] state apply error:", e);
    }
  }

  function applyRemoteMoveFromNetwork(msg) {
    if (!isValidMovePayload(msg.payload)) {
      syncMon.onInvalid?.(1);
      return;
    }

    const check = syncMon.verifyMoveHashes(msg);
    if (!check.ok) {
      netSend({ t: "state_req" });
      return;
    }

    const hasMandatoryCapture = anyCaptureAvailableFor(turn);
    const isQuiet = msg.payload?.type === "move";
    if (hasMandatoryCapture && isQuiet) {
      // Hay captura obligatoria pero el rival envía una jugada "quieta"
      syncMon.onInvalid?.(1);
      netSend({ t: "state_req" });
      return;
    }

    try {
      applyingRemote = true;
      const payload = msg.payload;

      if (payload.type === "move") {
        if (!safeCell(payload.from) || !safeCell(payload.to)) {
          syncMon.onInvalid?.(1);
          return;
        }
        const nb = aplicarMovimiento(board, {
          from: payload.from,
          to: payload.to,
        });
        if (nb !== board) {
          board = sanitizeBoard(nb);
          crownIfNeeded(board, payload.to);
          try {
            onMove();
          } catch {}
        } else {
          netSend({ t: "state_req" });
        }
      } else if (payload.type === "capture") {
        const sPath = safePath(payload.path);
        if (!sPath) {
          syncMon.onInvalid?.(1);
          return;
        }
        const nb = aplicarMovimiento(board, { path: sPath });
        if (nb !== board) {
          board = sanitizeBoard(nb);
          crownIfNeeded(board, last(sPath));
          try {
            onCaptureHop();
          } catch {}
        } else {
          netSend({ t: "state_req" });
        }
      }

      if (msg.endTurn === true) {
        turn = turn === COLOR.ROJO ? COLOR.NEGRO : COLOR.ROJO;
      }

      render();
      baseCtx.paintState();
      setTurnText();
      updateLock();

      // ▼▼▼ Registrar jugada REMOTA para el buffer de replay
      try {
        seqCtl?.recordLocalMove?.(msg);
      } catch {}

      const aft = syncMon.afterApplyMoveCheck(msg.nextH);
      if (aft.requestState) netSend({ t: "state_req" });
    } catch (e) {
      console.warn("[Online] Fallo aplicando jugada remota:", e);
    } finally {
      applyingRemote = false;
      updateLock();
    }
  }

  // ===== Recepción y aplicación de mensajes remotos
  function handleNetMessage(msg) {
    syncMon.onNetRecv?.(1);
    updateMetricsUI();

    // Fan-out para seqReplay
    _seqBus.emit(msg);

    if (!msg || typeof msg !== "object") return;
    if (msg.clientId && msg.clientId === CLIENT_ID) return;

    const msgV = msg.v == null ? 1 : msg.v;
    if (msgV !== PROTO_V) {
      // Versión de protocolo distinta: ignorar silenciosamente
      return;
    }

    if (msg.room && currentRoom && msg.room !== currentRoom) {
      // Mensaje de otra sala: ignorar
      return;
    }

    // Registrar cualquier clientId que llegue en un mensaje
    if (msg.clientId && typeof msg.clientId === "string") {
      peerIds.add(msg.clientId);
    }

    // Handshake de presencia (funciona en WS y BC)
    if (msg.t === "presence") {
      if (msg.clientId && typeof msg.clientId === "string") {
        peerIds.add(msg.clientId);
        // Responder para que el otro también me agregue (anti-carrera)
        if (msg.clientId !== CLIENT_ID) {
          netSend({
            t: "presence_ack",
            clientId: CLIENT_ID,
            ts: Date.now(),
          });
        }
        // Recalcular seating al ver un nuevo par
        recomputeSideFromPeers();
        // ▼▼▼ Enviar replay a nuevos pares
        try {
          seqCtl?.sendReplay?.();
        } catch {}
      }
      return;
    }
    if (msg.t === "presence_ack") {
      if (msg.clientId && typeof msg.clientId === "string") {
        peerIds.add(msg.clientId);
        recomputeSideFromPeers();
        // ▼▼▼ Enviar replay a nuevos pares
        try {
          seqCtl?.sendReplay?.();
        } catch {}
      }
      return;
    }

    // Auto-assign por WS cuando llega peers (y luego determinista por IDs)
    if (msg.t === "peers") {
      autoAssignSide({ peers: Math.max(0, msg.peers | 0) });
      recomputeSideFromPeers(); // asegura seating determinista
      setTurnText();
      updateLock();
      return;
    }

    if (msg.t === "hello" || msg.t === "join_ok" || msg.t === "join_ack") {
      return;
    }

    if (msg.t === "state_req") {
      netSendState();
      return;
    }

    // Mensajes de UI (restart, empate, resign, select, chat, rtc...)
    if (msg.t === "ui") {
      handleUIMessageFromNetwork(msg);
      return;
    }

    if (msg.t === "state") {
      applyRemoteStateFromNetwork(msg);
      return;
    }

    if (msg.t === "move" && msg.payload) {
      applyRemoteMoveFromNetwork(msg);
      return;
    }
  }

  // ===== Montaje final
  if (!seatingAppliedOnce) {
    autoAssignSide();
  }
  render();
  setTurnText();
  baseCtx.paintState();
  updateLock();
  try {
    if (GOLDEN_ENABLED) installGoldenHook(container);
  } catch {}

  // Importante: si ya hay pares/handshake, se recalcula y corrige el lado
  recomputeSideFromPeers();

  // ===== DEBUG — consola
  const ALLOWED = new Set(["r", "n", "R", "N"]);

  window.__D10 = {
    fen() {
      const rows = board
        .map((row) => row.map((x) => cellChar(x)).join(""))
        .join("\n");
      const t = turn === COLOR.ROJO ? "R" : "N";
      return rows + "\n" + t;
    },
    get() {
      return {
        board: board.map((r) => r.slice()),
        turn,
        localSide,
        flipOrientation,
        room: currentRoom || urlRoom,
      };
    },
    set(bOrText, t) {
      const apply = (newBoard, newTurn) => {
        applyingRemote = true;
        board = sanitizeBoard(newBoard);
        if (newTurn != null) turn = newTurn;
        render();
        baseCtx.paintState();
        setTurnText();
        updateLock();
        applyingRemote = false;
      };
      if (typeof bOrText === "string") {
        const lines = bOrText
          .trim()
          .split(/\r?\n/)
          .map((s) => s.trim());
        if (lines.length !== SIZE)
          throw new Error("Se esperaban 10 líneas");
        const grid = lines.map((line) => {
          if (line.length !== SIZE)
            throw new Error("Cada línea debe tener 10 caracteres");
          return line
            .split("")
            .map((ch) => (ALLOWED.has(ch) ? ch : ""));
        });
        const newTurn = t
          ? /^n$/i.test(t)
            ? COLOR.NEGRO
            : COLOR.ROJO
          : turn;
        apply(grid, newTurn);
        return;
      }
      if (bOrText && Array.isArray(bOrText.board)) {
        const cloneB = bOrText.board.map((r) => r.slice());
        const newTurn =
          bOrText.turn === COLOR.NEGRO ||
          bOrText.turn === COLOR.ROJO
            ? bOrText.turn
            : turn;
        apply(cloneB, newTurn);
        return;
      }
      throw new Error("Formato no reconocido para set()");
    },
    send() {
      try {
        netSendState();
      } catch {}
    },
    side(s) {
      // __D10.side('R'|'N')
      if (s === "R") localSide = COLOR.ROJO;
      else if (s === "N") localSide = COLOR.NEGRO;
      // Actualizar quién puede iniciar la llamada RTC
      isCallInitiator = !isSpectator && localSide === COLOR.ROJO;
      setTurnText();
      updateLock();
      render();
    },
    flip(f) {
      // __D10.flip(true|false)
      flipOrientation = !!f;
      saveOrientFlip(currentRoom || urlRoom, flipOrientation);
      updateOrientButton();
      render();
    },
  };

  console.log(
    "[Online] DEBUG listo: usa __D10.fen(), __D10.get(), __D10.set(texto,'R'|'N'), __D10.send(), __D10.side('R'|'N'), __D10.flip(true|false)"
  );

  // ===== Interacciones (si no espectador)
  if (!isSpectator) {
    attachBoardInteractions(container, {
      ...baseCtx,
      controller,
      getPlacing: () => placing,

      onCellClick: (r, c) => {
        console.log("[Online] onCellClick", { r, c, placing });

        // Modo "colocar piezas" (editor interno)
        if (placing) {
          const next = clone(board);
          next[r][c] = placing === "x" ? "" : placing;
          board = sanitizeBoard(next);
          controller.setBoard(board);
          render();
          baseCtx.paintState();
          netSendState();
          syncMon.onLocalChange?.();
          return true;
        }

        // Modo juego normal: solo pintamos aro local,
        // el envío remoto lo hace el listener de pointerdown
        const pos = [r, c];
        highlightSelected(pos);
        return true;
      },

      onQuietMove: (from, to) => {
        if (!safeCell(from) || !safeCell(to)) return;
        try {
          onMove();
        } catch {}
        try {
          const prevH = stateHash(board, turn);
          const nb = aplicarMovimiento(board, { from, to });
          if (nb !== board) {
            board = sanitizeBoard(nb);
            crownIfNeeded(board, to);
            render();
            baseCtx.paintState();
            const newTurn =
              turn === COLOR.ROJO ? COLOR.NEGRO : COLOR.ROJO;
            const nextH = stateHash(board, newTurn);
            netSend({
              t: "move",
              payload: { type: "move", from, to },
              endTurn: true,
              prevH,
              nextH,
            });

            // ▼▼▼ Registrar jugada local (quiet move) en el buffer de replay
            try {
              seqCtl?.recordLocalMove?.({
                t: "move",
                payload: { type: "move", from, to },
                endTurn: true,
                prevH,
                nextH,
                room: currentRoom,
                clientId: CLIENT_ID,
                v: PROTO_V,
              });
            } catch {}

            turn = newTurn;
            setTurnText();
            updateLock();
            baseCtx.paintState();
            netSendState();
            syncMon.onLocalChange?.();
          }
        } catch (e) {
          console.warn("[Online] onQuietMove emit failed:", e);
        }
      },

      onCaptureHop: (from, to, pathSoFar) => {
        try {
          onCaptureHop();
        } catch {}
        const basePath =
          Array.isArray(pathSoFar) && pathSoFar.length >= 2
            ? pathSoFar
            : [from, to];
        const path = safePath(basePath);
        if (!safeCell(from) || !safeCell(to) || !path) return;

        try {
          const prevH = stateHash(board, turn);
          const nb = aplicarMovimiento(board, { path });
          if (nb !== board) {
            board = sanitizeBoard(nb);
            const landing = last(path);
            crownIfNeeded(board, landing);
            const mvHere = baseMovimientos(board, landing) || {};
            const capsList =
              mvHere.captures ||
              mvHere.capturas ||
              mvHere.takes ||
              [];
            const moreCaps =
              Array.isArray(capsList) && capsList.length > 0;

            render();
            baseCtx.paintState();

            if (moreCaps) {
              const nextH = stateHash(board, turn); // turno NO cambia
              netSend({
                t: "move",
                payload: { type: "capture", path },
                endTurn: false,
                prevH,
                nextH,
              });

              // ▼▼▼ Registrar jugada local (captura, continúa cadena)
              try {
                seqCtl?.recordLocalMove?.({
                  t: "move",
                  payload: { type: "capture", path },
                  endTurn: false,
                  prevH,
                  nextH,
                  room: currentRoom,
                  clientId: CLIENT_ID,
                  v: PROTO_V,
                });
              } catch {}

              netSendState();
            } else {
              const newTurn =
                turn === COLOR.ROJO ? COLOR.NEGRO : COLOR.ROJO;
              const nextH = stateHash(board, newTurn);
              netSend({
                t: "move",
                payload: { type: "capture", path },
                endTurn: true,
                prevH,
                nextH,
              });

              // ▼▼▼ Registrar jugada local (captura, fin de cadena)
              try {
                seqCtl?.recordLocalMove?.({
                  t: "move",
                  payload: { type: "capture", path },
                  endTurn: true,
                  prevH,
                  nextH,
                  room: currentRoom,
                  clientId: CLIENT_ID,
                  v: PROTO_V,
                });
              } catch {}

              turn = newTurn;
              setTurnText();
              updateLock();
              baseCtx.paintState();
              netSendState();
            }
            syncMon.onLocalChange?.();
          }
        } catch (e) {
          console.warn("[Online] onCaptureHop emit failed:", e);
        }
      },
    });
  } else {
    // Espectador: solo banner
    const el = document.createElement("div");
    el.className = "spectator-banner";
    el.innerHTML =
      `<span class="dot"></span> Modo espectador — solo visualización`;
    document.body.appendChild(el);
  }

  // ===== Botones navegación/undo/restart/rotate
  function updateOrientButton() {
    if (!$btnRotate) return;
    const mode = flipOrientation ? "invertida" : "auto";
    $btnRotate.textContent = `Orientación: ${mode} (rotar)`;
  }
  updateOrientButton();

  setupOnlineButtons({
    container,
    updateOrientButton,
    getFlipOrientation: () => flipOrientation,
    setFlipOrientation: (v) => {
      flipOrientation = v;
    },
    saveFlip: saveOrientFlip,
    getCurrentRoom: () => currentRoom,
    urlRoom,
    render,
    getSeqCtl: () => seqCtl,
    closeTransport: closeRealtime,
    netSend,
    isSpectator,
    getStepState: () => stepState,
  });

  // ===== Conexiones manuales
  $btnConnect?.addEventListener("click", () => {
    const name = sanitizeRoom($roomInput?.value || urlRoom);
    connectBC(name);
  });

  $btnWSConn?.addEventListener("click", () => {
    const url = ($wsUrl?.value || DEFAULT_WS).trim();
    const room = sanitizeRoom($wsRoom?.value || urlRoom);
    if ($wsStatus) $wsStatus.textContent = "WS: Conectando…";

    // 🔵 Al hacer clic, marcamos visualmente "Conectando…"
    if ($btnWSConn) {
      $btnWSConn.classList.remove("online-btn--connected");
      $btnWSConn.classList.add("online-btn--disconnected");
      $btnWSConn.textContent = "Conectando…";
    }

    connectWS(url, room);
  });

  // Autoconexión por URL
  if (urlNet === "bc") connectBC(urlRoom);
  else if (urlNet === "ws") connectWS(WS_URL_FOR_QUERY, urlRoom);

  // ==========================
  // 🔘 Botones: Empate / Rendirse
  // ==========================
  setupDrawAndResignButtons({
    container,
    isSpectator,
    netSend,
    hardRestart,
  });

  // ==========================
  // 🔧 DEBUG: aplicar tablero (panel externo)
  // ==========================
  setupDebugPanel({
    container,
    SIZE,
    COLOR,
    sanitizeBoard,
    scrubNonPlayableSquares,
    getBoard: () => board,
    setBoard: (b) => {
      board = b;
    },
    getTurn: () => turn,
    setTurn: (t) => {
      turn = t;
    },
    setStepState: (s) => {
      stepState = s;
    },
    render,
    paintState: () => baseCtx.paintState(),
    setTurnText,
    updateLock,
    netSendState,
    syncMon,
    updateMetricsUI,
    boardToAscii,
  });
}
