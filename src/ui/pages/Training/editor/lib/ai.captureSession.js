// src/ui/pages/Training/editor/lib/ai.captureSession.js
// Captura manual de jugadas (Editor/Training) -> logMoves (localStorage) -> flush al backend (/ai/log-moves)

import { recordMove, getRecentMoves, clearMoves } from "../../../../../ai/learning/logMoves.js";

const TAG = "[AI-CAPTURE]";
const DEFAULT_API_BASE = "http://127.0.0.1:8001";

let recording = false;
let sessionId = null;
let buffered = 0;

function nowTs() { return Date.now(); }

function normalizeSide(side) {
  const s = String(side ?? "").toUpperCase();
  if (s.includes("ROJO") || s === "R" || s === "RED" || s === "WHITE" || s === "W") return "R";
  if (s.includes("NEGRO") || s === "N" || s === "BLACK" || s === "B") return "N";
  return s || "R";
}

function resolveApiBase() {
  // 1) env (Vite)
  try {
    const v = import.meta?.env?.VITE_IA_API_BASE;
    if (v) return String(v);
  } catch {}

  // 2) window override
  try {
    if (typeof window !== "undefined" && window.__AI_API_BASE) return String(window.__IA_API_BASE);
  } catch {}

  // 3) localStorage override
  try {
    const v = localStorage.getItem("d10.ai.apiBase");
    if (v) return String(v);
  } catch {}

  return DEFAULT_API_BASE;
}

function _safeJson(x) {
  try { return JSON.stringify(x); } catch { return String(x ?? ""); }
}

export function isAICapturing() {
  return !!recording;
}

export function getAICaptureInfo() {
  return { recording, sessionId, buffered };
}

export function startAICapture(meta = {}) {
  recording = true;
  sessionId = `sess_${nowTs()}`;
  buffered = 0;
  console.log(TAG, "startAICapture()", { sessionId, meta });
  return getAICaptureInfo();
}

export function stopAICapture(meta = {}) {
  recording = false;
  console.log(TAG, "stopAICapture()", { sessionId, buffered, meta });
  return getAICaptureInfo();
}

export function recordAIMove({ fen, side, move, score = 0, tag = "editor", meta = {} } = {}) {
  // OJO: este log es útil para ver si te llega move real
  console.log(TAG, "recordAIMove()", { hasFen: !!fen, side, move, tag });

  if (!recording) return { ok: false, reason: "not_recording" };

  const moveStr = String(move ?? "").trim();
  if (!moveStr) {
    console.log(TAG, "Ignorado: jugada sin move real", { move });
    return { ok: false, reason: "no_move" };
  }

  // ✅ FILTRO 1: NO aceptar jugadas “objeto JSON” (las que salen sin c6-d7)
  if (moveStr.startsWith("{") || moveStr.startsWith("[")) {
    console.log(TAG, "Bloqueado: move en formato objeto (no algebraico)", moveStr.slice(0, 80));
    return { ok: false, reason: "blocked_object_move" };
  }

  // ✅ FILTRO 2: NO aceptar jugadas con origen python/js (aunque vengan escapadas)
  const ms = moveStr.toLowerCase();
  if (ms.includes('"origin":"python"') || ms.includes('\\"origin\\":\\"python\\"') ||
      ms.includes('"origin":"js"')     || ms.includes('\\"origin\\":\\"js\\"')) {
    console.log(TAG, "Bloqueado: origen no-humano detectado en move", moveStr.slice(0, 120));
    return { ok: false, reason: "blocked_non_human_origin" };
  }

  // fen puede venir como array/obj -> lo guardamos como string estable
  let fenOut = fen;
  if (typeof fenOut !== "string") fenOut = _safeJson(fenOut);

  const row = {
    ts: nowTs(),
    sessionId,
    fen: fenOut,
    side: normalizeSide(side),
    move: moveStr,
    score: Number(score) || 0,
    tag: String(tag || "editor"),
    meta: meta && typeof meta === "object" ? meta : {},
  };

  try {
    const ok = recordMove(row); // ✅ export REAL
    if (!ok) return { ok: false, reason: "rejected_by_normalizer" };
    buffered += 1;
    return { ok: true, buffered };
  } catch (e) {
    return { ok: false, reason: "record_failed", error: String(e?.message || e) };
  }
}

async function _postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  return {
    ok: res.ok,
    status: res.status,
    url,
    responseText: text?.slice?.(0, 300) || "",
    responseJson: json,
  };
}

export async function flushAICapture({ limit = 400, apiBase, clearOnOk = true } = {}) {
  const base = String(apiBase || resolveApiBase()).replace(/\/$/, "");
  const url = `${base}/ai/log-moves`;

  const moves = getRecentMoves(limit);
  console.log(TAG, "flushAICapture() -> POST", { url, count: moves.length });

  if (!moves.length) {
    return { ok: true, status: "empty", sent: 0 };
  }

  try {
    // Intento 1: formato recomendado {moves:[...]}
    let resp = await _postJson(url, { moves });

    // Intento 2 (compat): si backend legacy esperaba array directo
    if (!resp.ok && (resp.status === 400 || resp.status === 422)) {
      const resp2 = await _postJson(url, moves);
      if (resp2.ok) resp = resp2;
    }

    console.log(TAG, "flush response", resp);

    if (resp.ok && clearOnOk) {
      try { clearMoves(); } catch {}
      buffered = 0;
    }

    return { ...resp, sent: moves.length };
  } catch (e) {
    const err = String(e?.message || e);
    console.warn(TAG, "flushAICapture() fallo de red:", err, { url });
    return { ok: false, status: "network_error", error: err, url, sent: moves.length };
  }
}

export async function stopAndFlushAICapture(opts = {}) {
  stopAICapture({ via: "stopAndFlush" });
  return flushAICapture(opts);
}
