// src/ui/api/ia.api.js
// Cliente del backend IA (FastAPI)
// - DEV (Vite): usa PROXY (/ai/*)
// - PROD (Render): usa VITE_AI_API_BASE (https://tu-backend.onrender.com)
// - NO lanza excepción en 422/400/500/etc: devuelve ok:false para fallback JS
// - Incluye TIMEOUT para que nunca quede colgado
// - ✅ MUESTRA el error real: intenta JSON y si no, lee texto (traceback)

function isDebugIA() {
  try {
    return (
      typeof window !== "undefined" &&
      window.location &&
      window.location.search.includes("debugIA=1")
    );
  } catch {
    return false;
  }
}

function dbg(...args) {
  if (!isDebugIA()) return;
  try {
    console.log(...args);
  } catch {}
}

/**
 * Limpia un board 10x10 a valores aceptables por backend:
 * 'r','n','R','N' o null. Devuelve lista 10x10 o null si no cumple.
 */
function cleanBoard10x10(board) {
  if (!Array.isArray(board) || board.length !== 10) return null;
  const out = [];
  for (let r = 0; r < 10; r++) {
    const row = board[r];
    if (!Array.isArray(row) || row.length !== 10) return null;
    const outRow = [];
    for (let c = 0; c < 10; c++) {
      const cell = row[c];
      if (cell === null || cell === undefined) {
        outRow.push(null);
        continue;
      }
      if (typeof cell === "string") {
        const s = cell.trim();
        if (s === "r" || s === "n" || s === "R" || s === "N") outRow.push(s);
        else outRow.push(null);
        continue;
      }
      outRow.push(null);
    }
    out.push(outRow);
  }
  return out;
}

function canonBoardJson(board10) {
  try {
    return JSON.stringify(board10);
  } catch {
    return null;
  }
}

function normalizeSide(sideToMove) {
  const s = String(sideToMove || "R")
    .trim()
    .toUpperCase();
  if (["R", "ROJO", "W", "WHITE", "BLANCO", "BLANCAS"].includes(s)) return "R";
  if (["N", "NEGRO", "B", "BLACK", "NEGRAS"].includes(s)) return "N";
  return s.startsWith("R") ? "R" : "N";
}

function isAbortError(e) {
  try {
    return (
      e?.name === "AbortError" ||
      String(e?.message || "").toLowerCase().includes("aborted")
    );
  } catch {
    return false;
  }
}

/**
 * ✅ LECTOR ROBUSTO:
 * - intenta JSON
 * - si no es JSON o falla, intenta texto (útil para 500 con traceback)
 */
async function readBodySmart(resp) {
  if (!resp) return { data: null, bodyText: null };
  const ct = (resp.headers?.get?.("content-type") || "").toLowerCase();

  if (ct.includes("application/json") || ct.includes("+json")) {
    try {
      const data = await resp.clone().json();
      return { data, bodyText: null };
    } catch {}
  }

  try {
    const bodyText = await resp.clone().text();
    return { data: null, bodyText: bodyText || null };
  } catch {
    return { data: null, bodyText: null };
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { ...options, signal: ctrl.signal });
    const { data, bodyText } = await readBodySmart(resp);
    return { resp, data, bodyText, error: null };
  } catch (e) {
    return { resp: null, data: null, bodyText: null, error: e };
  } finally {
    clearTimeout(t);
  }
}

/* ===========================
   ✅ BASE URL: DEV vs PROD
   - DEV: /ai/* (proxy Vite)
   - PROD: VITE_AI_API_BASE (Render)
   =========================== */

function getEnvApiBase() {
  // Vite inyecta import.meta.env.* en build
  try {
    const v = import.meta?.env?.VITE_AI_API_BASE;
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {}
  return "";
}

function normalizeBaseUrl(base) {
  // quita slash final
  try {
    return String(base || "")
      .trim()
      .replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * ✅ IMPORTANTE:
 * - DEV: usa proxy /ai/*
 * - PROD: usa VITE_AI_API_BASE si existe
 *
 * Ejemplo VITE_AI_API_BASE:
 *   https://tu-backend.onrender.com
 */
function apiUrl(path) {
  const p = String(path || "");
  const apiBase =
    normalizeBaseUrl(getEnvApiBase()) ||
    normalizeBaseUrl(window?.__AI_API_BASE) ||
    "";

  // Si hay base (producción o configurado), pegar directo al backend
  if (apiBase) return `${apiBase}/ai${p}`;

  // Si no hay base, asumimos DEV con proxy
  return `/ai${p}`;
}

export async function pedirJugadaIA(fen, sideToMove, boardSnapshot) {
  const side = normalizeSide(sideToMove);
  const board10 = cleanBoard10x10(boardSnapshot);
  const fenCanon = board10 ? canonBoardJson(board10) : null;

  const payload = {
    side,
    side_to_move: side,
    board: board10,
    fen: fenCanon,
  };

  dbg("[IA.API] POST", apiUrl("/move"), payload);

  const { resp, data, bodyText, error } = await fetchJsonWithTimeout(
    apiUrl("/move"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!resp) {
    return {
      ok: false,
      move: "",
      reason: isAbortError(error) ? "timeout_abort" : "network_error",
      meta: { error: String(error) },
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      move: "",
      reason: `http_${resp.status}`,
      meta: { bodyText, raw: data },
    };
  }

  return data;
}

export async function enviarLogIA(entries) {
  const list = Array.isArray(entries) ? entries : [entries];

  const { resp, data, bodyText } = await fetchJsonWithTimeout(apiUrl("/log-moves"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(list),
  });

  if (!resp || !resp.ok) {
    return { ok: false, bodyText, raw: data };
  }

  return data;
}

export async function getIAStats() {
  const { resp, data, bodyText } = await fetchJsonWithTimeout(apiUrl("/log-stats"), {
    method: "GET",
  });

  if (!resp || !resp.ok) {
    return { ok: false, bodyText, raw: data };
  }

  return data;
}

/**
 * ✅ ENSEÑAR IA (POST /ai/teach)
 * - DEV: proxy /ai/*
 * - PROD: VITE_AI_API_BASE
 * - Timeout + lectura robusta de error (json/text)
 * - No lanza excepción: devuelve ok:false para fallback y debug
 *
 * payload backend:
 *  { board: 10x10, side: "R"/"N", correct_move: "c3-d4", note?: "" }
 */
export async function enseñarIA({ board, side, correct_move, note = "" }) {
  const sideNorm = normalizeSide(side);
  const board10 = cleanBoard10x10(board);
  const payload = {
    side: sideNorm,
    side_to_move: sideNorm, // compat, por si lo quieres usar en backend
    board: board10,
    fen: board10 ? canonBoardJson(board10) : null, // compat/debug
    correct_move: String(correct_move || "").trim(),
    note: String(note || "").slice(0, 240),
    ts: Date.now(),
  };

  dbg("[IA.API] POST", apiUrl("/teach"), payload);

  // Validación suave (frontend) para no mandar basura
  if (!payload.board || payload.board.length !== 10) {
    return {
      ok: false,
      reason: "invalid_board_client",
      meta: { detail: "boardSnapshot no es 10x10 o contiene valores inválidos." },
    };
  }
  if (!payload.correct_move) {
    return {
      ok: false,
      reason: "missing_correct_move_client",
      meta: { detail: "Falta correct_move (ej: 'c3-d4')." },
    };
  }

  const { resp, data, bodyText, error } = await fetchJsonWithTimeout(
    apiUrl("/teach"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!resp) {
    return {
      ok: false,
      reason: isAbortError(error) ? "timeout_abort" : "network_error",
      meta: { error: String(error) },
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      reason: `http_${resp.status}`,
      meta: { bodyText, raw: data },
    };
  }

  // Si backend devolvió ok:false (aunque HTTP 200)
  if (data && data.ok === false) {
    return {
      ok: false,
      reason: data.reason || "teach_failed",
      meta: { raw: data, bodyText },
    };
  }

  return data;
}
