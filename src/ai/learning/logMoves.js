// src/ai/learning/logMoves.js
// Log local (RAM) de jugadas recientes para aprendizaje por experiencia.
// - Guarda SOLO entradas válidas (fen + move).
// - Canoniza fen (JSON estable) para match exacto.

let MOVES = [];
const MAX_MOVES = 2000;

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

  // si ya viene string, lo intentamos usar tal cual
  if (typeof fen === "string") {
    const s = fen.trim();
    if (!s) return null;

    // si parece JSON-lista, lo re-canonizamos (quita espacios)
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

  // si viene como board/obj, lo stringify
  const st = _stableStringify(fen);
  if (!st) return null;

  // si era lista, queda canónico sin espacios extra
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
  // si viene como objeto, lo guardamos como string
  const st = _stableStringify(mv);
  if (!st) return null;
  return st.trim() ? st : null;
}

function _normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const out = {
    ts: typeof entry.ts === "number" ? entry.ts : Date.now(),
    fen: entry.fen ?? entry.board ?? null,
    move: entry.move ?? null,
    score: typeof entry.score === "number" ? entry.score : 0,
    side: entry.side ?? null,
    tag: entry.tag ?? null,
    sessionId: entry.sessionId ?? null,
    meta: entry.meta ?? null,
  };

  // ✅ fen canónico (clave del match exacto)
  out.fen = _canonFen(out.fen);
  if (!out.fen) return null;

  // ✅ move normalizado
  out.move = _normalizeMove(out.move);

  // ✅ Sin jugada NO sirve para aprendizaje (evita move:null en ai_moves.jsonl)
  if (!out.move) return null;

  if (out.side != null) {
    const s = String(out.side).trim().toUpperCase();
    out.side = s ? s : null;
  }

  return out;
}

export function recordMove(entry) {
  const out = _normalizeEntry(entry);
  if (!out) return false;

  MOVES.push(out);
  if (MOVES.length > MAX_MOVES) {
    MOVES.splice(0, MOVES.length - MAX_MOVES);
  }
  return true;
}

export function getRecentMoves(n = 200) {
  const k = Math.max(0, Number(n) || 0);
  return MOVES.slice(-k);
}

export function clearMoves() {
  MOVES = [];
}

export function getMovesCount() {
  return MOVES.length;
}
