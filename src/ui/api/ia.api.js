// src/ui/api/ia.api.js
// Cliente del backend IA (FastAPI) usando PROXY de Vite (/ai/*)
// - Evita mixed-content cuando el frontend está en https://localhost:5173
// - NO lanza excepción en 422/400/etc: devuelve ok:false para fallback JS
// - Incluye TIMEOUT para que nunca quede colgado

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
  try { console.log(...args); } catch {}
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
      if (cell === null || cell === undefined) { outRow.push(null); continue; }
      if (typeof cell === "string") {
        const s = cell.trim();
        if (s === "r" || s === "n" || s === "R" || s === "N") outRow.push(s);
        else outRow.push(null);
        continue;
      }
      // objetos/ghost/etc
      outRow.push(null);
    }
    out.push(outRow);
  }
  return out;
}

function canonBoardJson(board10) {
  try { return JSON.stringify(board10); } catch { return null; }
}

function normalizeSide(sideToMove) {
  const s = String(sideToMove || "R").trim().toUpperCase();
  if (s === "R" || s === "ROJO" || s === "W" || s === "WHITE" || s === "BLANCO") return "R";
  if (s === "N" || s === "NEGRO" || s === "B" || s === "BLACK" || s === "NEGRAS") return "N";
  return s.startsWith("R") ? "R" : "N";
}

function isAbortError(e) {
  try {
    return e?.name === "AbortError" || String(e?.message || "").toLowerCase().includes("aborted");
  } catch {
    return false;
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 5200) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { ...options, signal: ctrl.signal });
    let data = null;
    try { data = await resp.json(); } catch {}
    return { resp, data };
  } catch (e) {
    return { resp: null, data: null, error: e };
  } finally {
    clearTimeout(t);
  }
}

/**
 * ✅ IMPORTANTE:
 * Siempre pegamos al PROXY del frontend:
 * - POST /ai/move
 * - POST /ai/log-moves
 * - GET  /ai/log-stats
 *
 * Eso evita mixed-content (https -> http) y funciona en LAN (https://192.168.x.x:5173).
 */
function apiUrl(path) {
  // path ejemplo: "/move", "/log-moves", "/log-stats"
  return `/ai${path}`;
}

export async function pedirJugadaIA(fen, sideToMove, boardSnapshot) {
  const side = normalizeSide(sideToMove);

  const board10 = cleanBoard10x10(boardSnapshot);
  const fenCanon = board10 ? canonBoardJson(board10) : (typeof fen === "string" ? fen : null);

  const payload = {
    side,
    side_to_move: side,
    board: board10,
    fen: fenCanon,
  };

  dbg("[IA.API] POST", apiUrl("/move"), "payload:", payload);

  const { resp, data, error } = await fetchJsonWithTimeout(
    apiUrl("/move"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    5200
  );

  if (!resp) {
    return {
      ok: false,
      move: "",
      reason: isAbortError(error) ? "timeout_abort" : "network_error",
      meta: { url: apiUrl("/move"), error: String(error?.message || error) },
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      move: "",
      reason: `http_${resp.status}`,
      meta: { url: apiUrl("/move"), detail: data?.detail ?? null, raw: data ?? null },
    };
  }

  return data;
}

export async function enviarLogIA(entries) {
  const list = Array.isArray(entries) ? entries : [entries];

  dbg("[IA.API] POST", apiUrl("/log-moves"), "entries:", list);

  const { resp, data, error } = await fetchJsonWithTimeout(
    apiUrl("/log-moves"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(list),
    },
    5200
  );

  if (!resp) return { ok: false, error: String(error?.message || error), url: apiUrl("/log-moves") };
  if (!resp.ok) return { ok: false, status: resp.status, detail: data?.detail ?? null, raw: data ?? null, url: apiUrl("/log-moves") };
  return data;
}

export async function getIAStats() {
  const { resp, data, error } = await fetchJsonWithTimeout(apiUrl("/log-stats"), { method: "GET" }, 5200);
  if (!resp) return { ok: false, error: String(error?.message || error), url: apiUrl("/log-stats") };
  if (!resp.ok) return { ok: false, status: resp.status, raw: data ?? null, url: apiUrl("/log-stats") };
  return data;
}
