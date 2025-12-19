// src/ai/learning/logMoves.js
// Log local de jugadas recientes para aprendizaje por experiencia.
// ✅ PERSISTE en localStorage.
// ✅ Incluye: readAllLines(), appendMoveLine()
// ✅ Extra: recordHumanFinalMove() (HUMANO + FEN único + formato algebraico)
// ✅ ARREGLO: bloquea basura python/js/objeto desde CUALQUIER fuente (último candado)

import { ingestPatternExample } from "./patterns.js";
let MOVES = [];
const MAX_MOVES = 2000;

// ✅ Persistencia
const LS_KEY = "D10_AI_MOVES_V1";

function _safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function _loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = _safeParseJSON(raw);
    if (Array.isArray(parsed)) MOVES = parsed.slice(0, MAX_MOVES);
  } catch {}
}

function _saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(MOVES.slice(-MAX_MOVES)));
  } catch {}
}

// Cargar una sola vez al importar el módulo
_loadFromLocalStorage();

function _stableStringify(x) {
  try {
    return JSON.stringify(x, null, 0);
  } catch {
    try { return String(x); } catch {}
  }
  return null;
}

function _canonFen(fen) {
  if (fen == null) return null;

  if (typeof fen === "string") {
    const s = fen.trim();
    if (!s) return null;

    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const parsed = JSON.parse(s);
        return JSON.stringify(parsed);
      } catch {
        return s;
      }
    }
    return s;
  }

  const st = _stableStringify(fen);
  if (!st) return null;

  try {
    const parsed = JSON.parse(st);
    return JSON.stringify(parsed);
  } catch {
    return st;
  }
}

function _normalizeMove(mv) {
  if (mv == null) return null;
  if (typeof mv === "string") {
    const s = mv.trim();
    return s ? s : null;
  }
  const st = _stableStringify(mv);
  if (!st) return null;
  return st.trim() ? st : null;
}

// ✅ Detecta basura "objeto" y/o "origin python/js" aunque venga escapado
function _isJunkMoveString(moveStr) {
  if (!moveStr || typeof moveStr !== "string") return true;
  const s = moveStr.trim();
  if (!s) return true;

  // 1) objeto/array serializado -> basura
  if (s.startsWith("{") || s.startsWith("[")) return true;

  // 2) contiene origin python/js (normal o escapado)
  const ms = s.toLowerCase();
  if (
    ms.includes('"origin":"python"') ||
    ms.includes('\\"origin\\":\\"python\\"') ||
    ms.includes('"origin":"js"') ||
    ms.includes('\\"origin\\":\\"js\\"')
  ) return true;

  return false;
}

function _normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const out = {
    ts: typeof entry.ts === "number" ? entry.ts : Date.now(),
    fen: entry.fen ?? entry.board ?? entry.k ?? null,
    move: entry.move ?? null,
    score: typeof entry.score === "number" ? entry.score : 0,
    side: entry.side ?? null,
    tag: entry.tag ?? null,
    sessionId: entry.sessionId ?? null,
    meta: entry.meta ?? null,
    source: entry.source ?? null,
  };

  // ✅ fen canónico
  out.fen = _canonFen(out.fen);
  if (!out.fen) return null;

  // ✅ move normalizado
  out.move = _normalizeMove(out.move);
  if (!out.move) return null;

  // ✅ ARREGLO #1: bloqueo total de basura python/js/objeto
  if (_isJunkMoveString(out.move)) {
    // debug suave
    console.warn("[logMoves] RECHAZADO: move basura (python/js/objeto)", out.move.slice(0, 120));
    return null;
  }

  // ✅ ARREGLO #2: bloqueo por meta.origin si alguien lo manda separado
  const metaOrigin = String(out?.meta?.origin ?? "").toLowerCase();
  if (metaOrigin === "python" || metaOrigin === "js" || metaOrigin === "backend") {
    console.warn("[logMoves] RECHAZADO: meta.origin no humano", metaOrigin);
    return null;
  }

  // ✅ ARREGLO #3: bloqueo por source si alguien lo manda ahí
  const src = String(out.source ?? "").toLowerCase();
  if (src === "python" || src === "js" || src === "backend") {
    console.warn("[logMoves] RECHAZADO: source no humano", src);
    return null;
  }

  if (out.side != null) {
    const s = String(out.side).trim().toUpperCase();
    out.side = s ? s : null;
  }

  if (out.tag != null) {
    const t = String(out.tag).trim();
    out.tag = t ? t : null;
  }

  if (out.source != null) {
    const s = String(out.source).trim().toLowerCase();
    out.source = s ? s : null;
  }

  return out;
}

// ------------------------------------------------------------
// helpers para deduplicación por FEN
// ------------------------------------------------------------
function _fenKey(fenCanon) {
  if (!fenCanon) return "";
  return String(fenCanon).trim();
}

export function getFenIndex() {
  const map = new Map();
  for (let i = 0; i < MOVES.length; i++) {
    const k = _fenKey(MOVES[i]?.fen);
    if (k) map.set(k, i);
  }
  return map;
}

export function hasFen(fen) {
  const k = _fenKey(_canonFen(fen));
  if (!k) return false;
  for (let i = MOVES.length - 1; i >= 0; i--) {
    if (_fenKey(MOVES[i]?.fen) === k) return true;
  }
  return false;
}

// ------------------------------------------------------------
// API original (compat)
// ------------------------------------------------------------
export function recordMove(entry) {
  const norm = _normalizeEntry(entry);
  if (!norm) return false;

  MOVES.push(norm);
  if (MOVES.length > MAX_MOVES) MOVES = MOVES.slice(-MAX_MOVES);

  _saveToLocalStorage();

  if (MOVES.length <= 3 || MOVES.length % 25 === 0) {
    console.log("[logMoves] +1", {
      total: MOVES.length,
      sample: { source: norm.source, side: norm.side, move: norm.move, fen0: norm.fen.slice(0, 30) }
    });
  }

  return true;
}

export function getRecentMoves(n = 200) {
  const k = Math.max(0, Number(n) || 0);
  if (!k) return [];
  return MOVES.slice(-k);
}

export function getMovesCount() {
  return MOVES.length;
}

export function clearMoves() {
  MOVES = [];
  _saveToLocalStorage();
  return true;
}

// ------------------------------------------------------------
// readAllLines(), appendMoveLine()
// ------------------------------------------------------------
export async function readAllLines() {
  return MOVES.slice();
}

export async function appendMoveLine(obj) {
  return recordMove(obj);
}

// ------------------------------------------------------------
// GRABACIÓN LIMPIA HUMANA
// ------------------------------------------------------------
function _isAlgebraicMove(move) {
  if (typeof move !== "string") return false;
  const s = move.trim().toLowerCase();
  return /^[a-j](10|[1-9])(-[a-j](10|[1-9]))+$/.test(s);
}

export function recordHumanFinalMove({
  fen,
  side,
  move,
  sessionId = null,
  meta = null,
  tag = "human",
  strict = true,
} = {}) {
  const fenCanon = _canonFen(fen);
  const fenK = _fenKey(fenCanon);

  if (!fenK) return { ok: false, reason: "no_fen" };

  // ✅ move debe ser algebraico
  if (!_isAlgebraicMove(move)) {
    return strict ? { ok: false, reason: "bad_move_format" } : { ok: false, reason: "skip" };
  }

  // ✅ dedupe por FEN
  if (hasFen(fenCanon)) return { ok: false, reason: "dup_fen" };

  const ok = recordMove({
    ts: Date.now(),
    source: "human",
    fen: fenCanon,
    move: move.trim(),
    side,
    tag,
    sessionId,
    meta,
    score: 0,
  });

if (ok) {
  ingestPatternExample({
    fen: fenCanon,
    move: move.trim(),
    side,
    ts: Date.now(),
  });
}

  return ok ? { ok: true } : { ok: false, reason: "record_failed" };
}

// ------------------------------------------------------------
// auditoría rápida
// ------------------------------------------------------------
export function auditMoves() {
  const counts = new Map();
  for (const m of MOVES) {
    const k = _fenKey(m?.fen);
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let dups = 0;
  let total = MOVES.length;

  const top = [];
  for (const [fenK, c] of counts.entries()) {
    if (c > 1) {
      dups += (c - 1);
      top.push({ fen0: fenK.slice(0, 50), count: c });
    }
  }
  top.sort((a, b) => b.count - a.count);

  const unique = counts.size;
  const dupPct = total ? Math.round((dups / total) * 100) : 0;

  return {
    total,
    uniqueFen: unique,
    duplicateLines: dups,
    duplicatePct: dupPct,
    topDupFen: top.slice(0, 10),
  };
}
