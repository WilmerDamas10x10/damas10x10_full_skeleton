// ===============================================
// src/ui/pages/Online/lib/net.controller.js
// Controlador de RED para modo Online (borrador alineado a tu código actual).
// -----------------------------------------------
// Objetivo:
// - Encapsular el transporte (BC/WS)
// - Centralizar el handleNetMessage
// - Mantener hooks para syncMon, replay y UI
//
// NOTA: En este paso 2 NO lo enchufamos aún a mountOnline.js.
//       Es un bloque listo para usar en un siguiente paso.
// ===============================================

import { createTransport, PROTO_V } from "./transport.js";

/**
 * @typedef {Object} NetControllerOptions
 * @property {string} room                      // sala normalizada
 * @property {string} clientId                  // CLIENT_ID
 * @property {function(): any} getLocalSnapshot // { board, turn, h }
 * @property {(snap:any)=>void} applySnapshot   // aplica snapshot remoto
 * @property {(msg:any)=>void} applyRemoteMove  // aplica jugada remota
 * @property {(msg:any)=>void} onUIMessage      // para t:"ui"
 * @property {(peers:Set<string>)=>void} onPresenceChange
 * @property {(metrics:any)=>void} onMetrics
 * @property {object} syncMon                   // instancia de createSyncMonitor(...)
 * @property {(msg:any)=>void} log
 */

export function createNetController(opts) {
  const {
    room,
    clientId,
    getLocalSnapshot,
    applySnapshot,
    applyRemoteMove,
    onUIMessage,
    onPresenceChange,
    onMetrics,
    syncMon,
    log = () => {},
  } = opts;

  let transport = null;
  let netMode = "none";      // "bc" | "ws" | "none"
  let wsState = "closed";    // estado reportado por createTransport("ws")
  const peers = new Set([clientId]);

  function updateMetrics() {
    try {
      const m = syncMon?.getMetrics?.();
      onMetrics?.(m || {});
    } catch {}
  }

  function announcePresence() {
    sendRaw({ t: "presence", clientId, ts: Date.now() });
  }

  function sendRaw(payload) {
    try {
      transport?.send?.({
        v: PROTO_V,
        room,
        clientId,
        ...payload,
      });
      syncMon?.onNetSent?.(1);
      updateMetrics();
    } catch (e) {
      log("[NET] send error", e);
    }
  }

  function sendState() {
    const snap = getLocalSnapshot?.();
    if (!snap) return;
    sendRaw({
      t: "state",
      board: snap.board,
      turn: snap.turn,
      h: snap.h,
    });
  }

  function handlePresence(msg) {
    if (msg.clientId && typeof msg.clientId === "string") {
      peers.add(msg.clientId);
      onPresenceChange?.(new Set(peers));
    }
  }

  function handleNetMessage(msg) {
    syncMon?.onNetRecv?.(1);
    updateMetrics();

    if (!msg || typeof msg !== "object") return;
    if (msg.clientId && msg.clientId === clientId) return;

    const msgV = msg.v == null ? 1 : msg.v;
    if (msgV !== PROTO_V) return;
    if (msg.room && msg.room !== room) return;

    // presence / ack
    if (msg.t === "presence") {
      handlePresence(msg);
      // respondemos para que el otro también nos agregue
      if (msg.clientId !== clientId) {
        sendRaw({ t: "presence_ack", clientId, ts: Date.now() });
      }
      return;
    }
    if (msg.t === "presence_ack") {
      handlePresence(msg);
      return;
    }

    // request de estado
    if (msg.t === "state_req") {
      sendState();
      return;
    }

    // snapshot remoto
    if (msg.t === "state") {
      try {
        const r = syncMon?.handleIncomingState?.(msg);
        applySnapshot?.(msg, r);
      } catch (e) {
        log("[NET] error aplicando snapshot remoto", e);
      }
      updateMetrics();
      return;
    }

    // jugada remota
    if (msg.t === "move") {
      try {
        const check = syncMon?.verifyMoveHashes?.(msg);
        if (!check || !check.ok) {
          // pedimos snapshot bueno
          sendRaw({ t: "state_req" });
          return;
        }
        applyRemoteMove?.(msg);
        const aft = syncMon?.afterApplyMoveCheck?.(msg.nextH);
        if (aft?.requestState) {
          sendRaw({ t: "state_req" });
        }
      } catch (e) {
        log("[NET] error aplicando jugada remota", e);
      } finally {
        updateMetrics();
      }
      return;
    }

    // mensajes de UI (restart, draw, rtc, chat, halos, etc.)
    if (msg.t === "ui") {
      onUIMessage?.(msg);
      return;
    }

    log("[NET] mensaje desconocido:", msg);
  }

  function connectBC() {
    disconnect();
    netMode = "bc";
    wsState = "open";

    transport = createTransport("bc", room, handleNetMessage, (st) => {
      log("[NET] BC status:", st);
    });

    // join explícito
    transport?.send?.({ t: "join", v: PROTO_V, room, clientId });
    announcePresence();
  }

  function connectWS(wsUrl) {
    disconnect();
    netMode = "ws";
    wsState = "connecting";

    transport = createTransport(
      "ws",
      room,
      handleNetMessage,
      (st) => {
        wsState = st?.state || wsState;
        log("[NET] WS status:", st);
        if (st?.state === "open") {
          // cuando abre, pedimos estado y anunciamos presencia
          sendRaw({ t: "state_req" });
          announcePresence();
        }
        updateMetrics();
      },
      { wsUrl }
    );

    // join explícito
    transport?.send?.({ t: "join", v: PROTO_V, room, clientId });
  }

  function disconnect() {
    try {
      transport?.close?.();
    } catch {}
    transport = null;
    netMode = "none";
    wsState = "closed";
  }

  return {
    connectBC,
    connectWS,
    disconnect,
    sendRaw,
    sendState,
    getNetMode: () => netMode,
    getWsState: () => wsState,
    getPeers: () => new Set(peers),
  };
}
