// src/ui/pages/Training/editor/lib/ai.captureSession.js
// FASE 1 — Grabación manual (Editor) + buffer + flush al backend
// - NO graba si no estás en modo grabación
// - Guarda en RAM y se envía al final (o cuando llames flush)
// - ✅ También “duplica” en logMoves.js para que trainer.js tenga datos
// - ✅ Incluye stopAndFlushAICapture() para auto-train al finalizar
//
// ✅ FIX CLAVE:
// - Antes se ignoraba si entry.move no era string.
// - Ahora acepta move como:
//   - string "e3-f4" / "c3-e5-g7"
//   - objeto {from:[r,c], to:[r,c]}
//   - objeto {path:[[r,c],...]} o {route:[[r,c],...]}

import { recordMove } from "../../../../../ai/learning/logMoves.js";
import { trainModel } from "../../../../../ai/learning/trainer.js";

let recording = false;
let sessionId = null;
let buffer = [];

function safeId() {
  return `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeFen(v) {
  // En el Editor a veces fen viene como board (array/objeto), así que lo convertimos.
  if (v == null) return null;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch {}
  try { return String(v); } catch {}
  return null;
}

function hasCoordsPair(x) {
  return Array.isArray(x) && x.length === 2 && Number.isFinite(+x[0]) && Number.isFinite(+x[1]);
}

function looksLikeRealMove(mv) {
  if (mv == null) return false;

  if (typeof mv === "string") {
    return mv.trim().length > 0;
  }

  if (typeof mv === "object") {
    // path/route multi-captura
    if (Array.isArray(mv.path) && mv.path.length >= 2 && mv.path.every(hasCoordsPair)) return true;
    if (Array.isArray(mv.route) && mv.route.length >= 2 && mv.route.every(hasCoordsPair)) return true;

    // from/to simple
    if (hasCoordsPair(mv.from) && hasCoordsPair(mv.to)) return true;
  }

  return false;
}

export function startAICapture() {
  recording = true;
  sessionId = safeId();
  buffer = [];
  console.log("[AI-CAPTURE] startAICapture()", { sessionId });
  return { ok: true, sessionId };
}

export function stopAICapture() {
  recording = false;
  const info = { ok: true, sessionId, entries: buffer.length };
  console.log("[AI-CAPTURE] stopAICapture()", info);
  return info;
}

export function isAICapturing() {
  return !!recording;
}

export function getAICaptureInfo() {
  return { recording, sessionId, buffered: buffer.length };
}

export function recordAIMove(entry = {}) {
  if (!recording) return false;

  const fenNorm = normalizeFen(entry.fen);

  // ✅ Aceptar move string u objeto (from/to, path/route)
  const mv = entry.move ?? entry;

  if (!looksLikeRealMove(mv)) {
    // Esto normalmente ocurre en clicks/selección/preview. No es jugada real.
    console.log("[AI-CAPTURE] Ignorado: jugada sin move real", {
      keys: Object.keys(entry || {}),
      moveType: typeof entry?.move,
      hasFromTo: !!(entry?.from && entry?.to),
      hasPath: !!entry?.path,
      hasRoute: !!entry?.route,
    });
    return false;
  }

  const row = {
    ts: Date.now(),
    sessionId,
    fen: fenNorm ?? null,
    side: entry.side ?? null,
    move: mv ?? null,                // ✅ puede ser string u objeto
    score: typeof entry.score === "number" ? entry.score : 0,
    tag: entry.tag ?? "editor",
    meta: entry.meta ?? null,
  };

  buffer.push(row);

  // ✅ IMPORTANTÍSIMO: también lo metemos en logMoves.js (trainer.js lee desde ahí)
  try {
    recordMove({
      ts: row.ts,
      fen: row.fen,
      move: row.move, // ✅ objeto permitido (logMoves lo stringify si hace falta)
      score: row.score,
      side: row.side,
      tag: row.tag,
      sessionId: row.sessionId,
      meta: row.meta,
    });
  } catch (e) {
    console.warn("[AI-CAPTURE] recordMove() falló:", e);
  }

  if (buffer.length <= 3 || buffer.length % 10 === 0) {
    console.log("[AI-CAPTURE] recordAIMove()", {
      buffered: buffer.length,
      sample: {
        fen: row.fen?.slice?.(0, 32) ?? row.fen,
        move: typeof row.move === "string" ? row.move : "(obj)",
        side: row.side
      },
    });
  }

  return true;
}

function _guessBase() {
  return (window.__AI_API_BASE || "").trim();
}

export async function flushAICapture({ endpoint = "/ai/log-moves" } = {}) {
  const payload = buffer.slice();
  buffer = [];

  console.log("[AI-CAPTURE] flushAICapture()", {
    endpoint,
    base: _guessBase() || "(same-origin)",
    sending: payload.length,
    preview0: payload[0]
      ? {
          fen: (payload[0].fen || "").slice(0, 40),
          move: typeof payload[0].move === "string" ? payload[0].move : "(obj)",
          side: payload[0].side
        }
      : null,
  });

  if (!payload.length) return { ok: true, sent: 0, empty: true };

  const base = _guessBase();
  const url = base ? `${base}${endpoint}` : endpoint;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let text = "";
    try { text = await res.text(); } catch {}

    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}

    const info = {
      ok: res.ok,
      sent: payload.length,
      status: res.status,
      url,
      responseText: text?.slice?.(0, 250) || "",
      responseJson: json,
    };

    console.log("[AI-CAPTURE] flush response", info);
    return info;
  } catch (e) {
    buffer = payload.concat(buffer);
    const err = { ok: false, sent: 0, error: String(e?.message || e) };
    console.warn("[AI-CAPTURE] flush error", err);
    return err;
  }
}

/**
 * ✅ Nuevo: Finalizar + Flush + Auto-train
 */
export async function stopAndFlushAICapture({ endpoint = "/ai/log-moves", autoTrain = true } = {}) {
  const stopped = stopAICapture();
  const flushed = await flushAICapture({ endpoint });

  if (autoTrain) {
    try {
      console.log("[learning] auto-train after stop+flush");
      await trainModel();
    } catch (e) {
      console.warn("[learning] auto-train error:", e);
    }
  }

  return { stopped, flushed };
}
