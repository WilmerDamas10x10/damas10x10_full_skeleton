// ==============================================
// src/ai/learning/patterns.js
// Patrones (features) derivados de una posición.
// NO graba partidas. NO reemplaza ai_moves.jsonl.
// Solo calcula patternKey + utilidades para index.
// ==============================================

const PATTERN_VERSION = "v1";
const LS_KEY = "ai_pattern_index_v1";

// ==============================================
// PASO 8 — Sync con Backend (persistencia real)
// Usa rutas relativas (funciona con proxy Vite / mismo dominio).
// Endpoints:
//   GET  /ai/patterns/index
//   POST /ai/patterns/sync   body: { patterns: {...} }
// ==============================================

let _patternSyncEnabled = true;         // puedes poner false si quieres desactivar temporalmente
let _patternSyncBase = "/ai/patterns";  // si NO hay proxy, luego se cambia a "http://127.0.0.1:8001/ai/patterns"

let _pushTimer = null;
let _lastPushedJson = "";              // evita pushes repetidos

export function enableServerPatternSync(opts = {}) {
  if (typeof opts.enabled === "boolean") _patternSyncEnabled = opts.enabled;
  if (typeof opts.base === "string" && opts.base.trim()) _patternSyncBase = opts.base.trim();
  return { enabled: _patternSyncEnabled, base: _patternSyncBase };
}

export async function pullPatternIndexFromServer() {
  if (!_patternSyncEnabled) return { ok: false, reason: "sync_disabled" };

  try {
    const res = await fetch(`${_patternSyncBase}/index`, { method: "GET" });
    if (!res.ok) return { ok: false, status: res.status };

    const data = await res.json();
    if (!data || data.ok !== true) return { ok: false, reason: "bad_payload", data };

    const patterns = data.patterns || {};
    const idx = { v: PATTERN_VERSION, patterns };

    // Cache rápido (pero la fuente de verdad es el backend).
    localStorage.setItem(LS_KEY, JSON.stringify(idx));

    return { ok: true, count: Object.keys(patterns).length, source: data.source || "unknown" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function _pushNow(patternsObj) {
  if (!_patternSyncEnabled) return { ok: false, reason: "sync_disabled" };

  try {
    const body = JSON.stringify({ patterns: patternsObj || {} });

    // evita re-enviar lo mismo una y otra vez
    if (body === _lastPushedJson) return { ok: true, skipped: true };

    const res = await fetch(`${_patternSyncBase}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) return { ok: false, status: res.status };

    const data = await res.json();
    if (data?.ok) _lastPushedJson = body;

    return data;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function _schedulePush(patternsObj) {
  if (!_patternSyncEnabled) return;

  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    _pushNow(patternsObj);
  }, 800); // debounce
}

/**
 * API principal (Día 1)
 * - patternKeyFromFEN(fen, side)
 * - extractFeaturesFromFEN(fen, side)
 * - loadPatternIndex(), savePatternIndex()
 * - ingestPatternExample({ fen, move, side, ts })
 */

export function patternKeyFromFEN(fenRaw, side = "?") {
  const f = extractFeaturesFromFEN(fenRaw, side);
  return featuresToPatternKey(f, side);
}

export function extractFeaturesFromFEN(fenRaw, side = "?") {
  const { board } = parseAnyFEN10x10(fenRaw);

  // Conteos material:
  // rojas: 'r' peón, 'R' dama
  // negras: 'n' peón, 'N' dama
  let rMan = 0, rKing = 0, nMan = 0, nKing = 0;

  // Centro (zona 4x4 en tablero 10x10: filas 3..6, cols 3..6)
  let rCenter = 0, nCenter = 0;

  // “Avance” heurístico simple por filas
  // asumimos fila 0 arriba, fila 9 abajo
  let rRowSum = 0, rCount = 0, nRowSum = 0, nCount = 0;

  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const p = board[y][x];
      if (!p) continue;

      if (p === "r") { rMan++; rRowSum += y; rCount++; }
      else if (p === "R") { rKing++; rRowSum += y; rCount++; }
      else if (p === "n") { nMan++; nRowSum += y; nCount++; }
      else if (p === "N") { nKing++; nRowSum += y; nCount++; }

      if (y >= 3 && y <= 6 && x >= 3 && x <= 6) {
        if (p === "r" || p === "R") rCenter++;
        if (p === "n" || p === "N") nCenter++;
      }
    }
  }

  // Movilidad/capturas (aprox, sin depender del motor)
  const rCap = hasAnyCapture(board, "R");
  const nCap = hasAnyCapture(board, "N");

  const rMob = pseudoMobility(board, "R");
  const nMob = pseudoMobility(board, "N");

  // Avance:
  // rojas “avanzan” hacia arriba (menor y) => avance alto si y promedio es bajo
  // negras “avanzan” hacia abajo (mayor y) => avance alto si y promedio es alto
  const rAvgY = rCount ? (rRowSum / rCount) : 9;
  const nAvgY = nCount ? (nRowSum / nCount) : 0;
  const rAdvance = clamp01(1 - (rAvgY / 9));
  const nAdvance = clamp01(nAvgY / 9);

  // Material ponderado (peón 1, dama 1.5)
  const rMat = rMan * 1 + rKing * 1.5;
  const nMat = nMan * 1 + nKing * 1.5;

  return {
    rMan, rKing, nMan, nKing,
    rMat, nMat,
    matDiff: rMat - nMat,

    rCenter, nCenter,
    centerDiff: rCenter - nCenter,

    rCap, nCap,
    rMob, nMob,
    mobDiff: rMob - nMob,

    rAdvance, nAdvance,
    advDiff: rAdvance - nAdvance,

    side,
  };
}

export function featuresToPatternKey(f, side = "?") {
  const md = bucket(f.matDiff, 0.5, -8, 8);
  const kd = clampInt((f.rKing - f.nKing), -5, 5);
  const cd = clampInt((f.centerDiff), -10, 10);

  const mob = bucket(f.mobDiff, 2, -20, 20);
  const adv = bucket(f.advDiff, 0.15, -1, 1);

  const cap = (side === "R") ? (f.rCap ? 1 : 0)
            : (side === "N") ? (f.nCap ? 1 : 0)
            : ((f.rCap || f.nCap) ? 1 : 0);

  return [
    PATTERN_VERSION,
    `s:${side || "?"}`,
    `md:${md}`,
    `kd:${kd}`,
    `cd:${cd}`,
    `mob:${mob}`,
    `adv:${adv}`,
    `cap:${cap}`,
  ].join("|");
}

// ----------------------
// Index en localStorage
// ----------------------

export function loadPatternIndex() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { v: PATTERN_VERSION, patterns: {} };
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return { v: PATTERN_VERSION, patterns: {} };
    if (!obj.patterns) obj.patterns = {};
    return obj;
  } catch {
    return { v: PATTERN_VERSION, patterns: {} };
  }
}

export function savePatternIndex(indexObj) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(indexObj));

    // ✅ PASO 8: persistencia real (backend)
    if (indexObj && indexObj.patterns) {
      _schedulePush(indexObj.patterns);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Ingiere un ejemplo humano para construir el índice por patrón.
 * OJO: esto NO reemplaza ai_moves.jsonl. Solo agrega un “resumen estadístico”.
 */
export function ingestPatternExample({ fen, move, side, ts = Date.now() }) {
  if (!fen || !move) return { ok: false, reason: "missing fen/move" };

  const key = patternKeyFromFEN(fen, side);
  const idx = loadPatternIndex();
  const patterns = idx.patterns;

  if (!patterns[key]) {
    patterns[key] = { n: 0, lastTs: 0, moveCounts: {} };
  }

  const node = patterns[key];
  node.n += 1;
  node.lastTs = Math.max(node.lastTs || 0, ts);
  node.moveCounts[move] = (node.moveCounts[move] || 0) + 1;

  savePatternIndex(idx);

  return { ok: true, key, n: node.n, top: topMoves(node.moveCounts, 3) };
}

// ----------------------
// Helpers internos
// ----------------------

function parseAnyFEN10x10(fenRaw) {
  const res = { board: emptyBoard10(), side: null };

  if (fenRaw && typeof fenRaw === "object") {
    if (Array.isArray(fenRaw)) {
      res.board = normalizeBoardArray(fenRaw);
      return res;
    }
    if (fenRaw.board && Array.isArray(fenRaw.board)) {
      res.board = normalizeBoardArray(fenRaw.board);
      return res;
    }
  }

  const s = String(fenRaw || "");
  if (!s) return res;

  const parts = s.split("|");
  const main = parts[0] || "";
  const sidePart = parts.find(p => p.startsWith("side:"));
  if (sidePart) res.side = sidePart.split(":")[1] || null;

  const trimmed = main.trim();

  if (trimmed.startsWith("[[")) {
    try {
      const arr = JSON.parse(trimmed);
      res.board = normalizeBoardArray(arr);
      return res;
    } catch {
      // cae al parser de filas
    }
  }

  const rows = trimmed.split("/");
  if (rows.length === 10) {
    const board = emptyBoard10();
    for (let y = 0; y < 10; y++) {
      const row = rows[y] || "";
      for (let x = 0; x < 10; x++) {
        const ch = row[x];
        if (!ch || ch === ".") continue;
        if (ch === "r" || ch === "R" || ch === "n" || ch === "N") board[y][x] = ch;
      }
    }
    res.board = board;
  }

  return res;
}

function normalizeBoardArray(arr) {
  const board = emptyBoard10();
  for (let y = 0; y < 10; y++) {
    const row = arr[y] || [];
    for (let x = 0; x < 10; x++) {
      const v = row[x];
      if (v === "r" || v === "R" || v === "n" || v === "N") board[y][x] = v;
      else board[y][x] = null;
    }
  }
  return board;
}

function emptyBoard10() {
  return Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null));
}

function pseudoMobility(board, side) {
  const mine = side === "R" ? ["r", "R"] : ["n", "N"];
  const dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  let m = 0;

  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const p = board[y][x];
      if (!mine.includes(p)) continue;
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx > 9 || ny < 0 || ny > 9) continue;
        if (!board[ny][nx]) m++;
      }
    }
  }
  return m;
}

function hasAnyCapture(board, side) {
  const mine = side === "R" ? ["r", "R"] : ["n", "N"];
  const opp  = side === "R" ? ["n", "N"] : ["r", "R"];
  const dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const p = board[y][x];
      if (!mine.includes(p)) continue;

      for (const [dx, dy] of dirs) {
        const mx = x + dx, my = y + dy;
        const lx = x + 2 * dx, ly = y + 2 * dy;
        if (lx < 0 || lx > 9 || ly < 0 || ly > 9) continue;
        if (mx < 0 || mx > 9 || my < 0 || my > 9) continue;

        if (opp.includes(board[my][mx]) && !board[ly][lx]) return true;
      }
    }
  }
  return false;
}

function topMoves(moveCounts, k = 3) {
  return Object.entries(moveCounts || {})
    .sort((a, b) => (b[1] - a[1]))
    .slice(0, k)
    .map(([move, count]) => ({ move, count }));
}

function bucket(value, step, minV, maxV) {
  const v = Math.max(minV, Math.min(maxV, value));
  return Math.round(v / step);
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clampInt(x, a, b) {
  if (x < a) return a;
  if (x > b) return b;
  return x | 0;
}

// ==============================================
// SUGERIDOR POR PATRONES (exacto)
// ==============================================

export function suggestMoveFromPatterns(fen, side, opts = {}) {
  const {
    k = 3,
    minCount = 2,
    maxAgeDays = 180,
    preferRecent = true,
  } = opts;

  const key = patternKeyFromFEN(fen, side);
  const idx = loadPatternIndex();
  const node = idx?.patterns?.[key];

  if (!node || !node.moveCounts) {
    return { ok: false, key, suggestions: [], meta: { reason: "no_pattern" } };
  }

  const now = Date.now();
  const recencyDays = node.lastTs ? (now - node.lastTs) / (1000 * 60 * 60 * 24) : 9999;

  if (recencyDays > maxAgeDays) {
    return { ok: false, key, suggestions: [], meta: { reason: "pattern_too_old", recencyDays } };
  }

  const entries = Object.entries(node.moveCounts)
    .map(([move, count]) => ({ move, count }))
    .filter(x => x.count >= minCount);

  if (!entries.length) {
    return { ok: false, key, suggestions: [], meta: { reason: "below_minCount" } };
  }

  const ranked = entries
    .map(x => {
      const freqScore = x.count;
      const recentBonus = preferRecent ? recencyBonus(node.lastTs, now) : 0;
      return {
        move: x.move,
        count: x.count,
        recencyDays: Math.round(recencyDays * 10) / 10,
        score: freqScore + recentBonus,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return {
    ok: true,
    key,
    suggestions: ranked,
    meta: {
      nExamples: node.n || 0,
      lastTs: node.lastTs || 0,
      recencyDays: Math.round(recencyDays * 10) / 10,
      used: { k, minCount, maxAgeDays, preferRecent },
    },
  };
}

// ==============================================
// SUGERIDOR "FUZZY" (vecinos por buckets) — BUENO
// ==============================================

export function suggestMoveFromSimilarPatterns(fen, side, opts = {}) {
  const {
    k = 3,
    minCount = 2,
    maxAgeDays = 180,
    preferRecent = true,

    radiusMd = 1,
    radiusMob = 1,
    radiusAdv = 1,
    radiusCd = 1,
    radiusKd = 0,
    maxCandidates = 120,
  } = opts;

  const key0 = patternKeyFromFEN(fen, side);
  const parsed0 = parsePatternKey(key0);
  if (!parsed0) {
    return { ok: false, key: key0, suggestions: [], meta: { reason: "bad_key" } };
  }

  const idx = loadPatternIndex();
  const patterns = idx?.patterns || {};
  const now = Date.now();

  const candidates = generateNeighborKeys(parsed0, {
    radiusMd, radiusMob, radiusAdv, radiusCd, radiusKd, maxCandidates
  });

  const moveScores = Object.create(null);
  let usedNodes = 0;

  for (const cand of candidates) {
    const node = patterns[cand.key];
    if (!node || !node.moveCounts) continue;

    const recDays = node.lastTs ? (now - node.lastTs) / (1000 * 60 * 60 * 24) : 9999;
    if (recDays > maxAgeDays) continue;

    const w = 1 / (1 + cand.dist);
    usedNodes++;

    for (const [mv, cnt] of Object.entries(node.moveCounts)) {
      if (cnt < minCount) continue;
      const recentBonus = preferRecent ? recencyBonus(node.lastTs, now) : 0;
      const s = (cnt + recentBonus) * w;

      if (!moveScores[mv]) {
        moveScores[mv] = { scoreSum: 0, countSum: 0, hits: 0, bestRecencyDays: recDays };
      }
      moveScores[mv].scoreSum += s;
      moveScores[mv].countSum += cnt;
      moveScores[mv].hits += 1;
      moveScores[mv].bestRecencyDays = Math.min(moveScores[mv].bestRecencyDays, recDays);
    }
  }

  const ranked = Object.entries(moveScores)
    .map(([move, o]) => ({
      move,
      count: o.countSum,
      recencyDays: Math.round(o.bestRecencyDays * 10) / 10,
      score: Math.round(o.scoreSum * 1000) / 1000,
      hits: o.hits,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  if (!ranked.length) {
    return {
      ok: false,
      key: key0,
      suggestions: [],
      meta: { reason: "no_similar_pattern", tried: candidates.length, usedNodes }
    };
  }

  return {
    ok: true,
    key: key0,
    suggestions: ranked,
    meta: {
      mode: "fuzzy",
      tried: candidates.length,
      usedNodes,
      used: { k, minCount, maxAgeDays, preferRecent, radiusMd, radiusMob, radiusAdv, radiusCd, radiusKd, maxCandidates }
    }
  };
}

// Helpers fuzzy
function parsePatternKey(key) {
  try {
    const parts = String(key || "").split("|");
    const get = (prefix) => {
      const p = parts.find(x => String(x).startsWith(prefix));
      if (!p) return null;
      const v = p.split(":")[1];
      return v == null ? null : v;
    };

    const v = parts[0] || null;
    const side = (get("s") ?? "?").toString();

    const md = parseInt(get("md"), 10);
    const kd = parseInt(get("kd"), 10);
    const cd = parseInt(get("cd"), 10);
    const mob = parseInt(get("mob"), 10);
    const adv = parseInt(get("adv"), 10);
    const cap = parseInt(get("cap"), 10);

    if (!v) return null;
    if ([md, kd, cd, mob, adv, cap].some(n => Number.isNaN(n))) return null;

    return { v, side, md, kd, cd, mob, adv, cap };
  } catch {
    return null;
  }
}

function makeKeyFromParsed(p) {
  return [
    p.v,
    `s:${p.side || "?"}`,
    `md:${p.md}`,
    `kd:${p.kd}`,
    `cd:${p.cd}`,
    `mob:${p.mob}`,
    `adv:${p.adv}`,
    `cap:${p.cap}`,
  ].join("|");
}

function generateNeighborKeys(p0, cfg) {
  const {
    radiusMd = 1,
    radiusMob = 1,
    radiusAdv = 1,
    radiusCd = 1,
    radiusKd = 0,
    maxCandidates = 120,
  } = cfg || {};

  const keys = [];
  const push = (md, kd, cd, mob, adv) => {
    const dist = Math.abs(md - p0.md) + Math.abs(kd - p0.kd) + Math.abs(cd - p0.cd) +
                 Math.abs(mob - p0.mob) + Math.abs(adv - p0.adv);
    keys.push({ key: makeKeyFromParsed({ ...p0, md, kd, cd, mob, adv }), dist });
  };

  for (let dMd = -radiusMd; dMd <= radiusMd; dMd++) {
    for (let dMob = -radiusMob; dMob <= radiusMob; dMob++) {
      for (let dAdv = -radiusAdv; dAdv <= radiusAdv; dAdv++) {
        for (let dCd = -radiusCd; dCd <= radiusCd; dCd++) {
          for (let dKd = -radiusKd; dKd <= radiusKd; dKd++) {
            push(p0.md + dMd, p0.kd + dKd, p0.cd + dCd, p0.mob + dMob, p0.adv + dAdv);
            if (keys.length >= maxCandidates) break;
          }
          if (keys.length >= maxCandidates) break;
        }
        if (keys.length >= maxCandidates) break;
      }
      if (keys.length >= maxCandidates) break;
    }
    if (keys.length >= maxCandidates) break;
  }

  keys.sort((a, b) => a.dist - b.dist);
  const seen = new Set();
  const out = [];
  for (const k of keys) {
    if (seen.has(k.key)) continue;
    seen.add(k.key);
    out.push(k);
    if (out.length >= maxCandidates) break;
  }
  return out;
}

function recencyBonus(lastTs, now) {
  if (!lastTs) return 0;
  const days = (now - lastTs) / (1000 * 60 * 60 * 24);
  const b = 1.5 / (1 + (days / 30));
  return Math.round(b * 100) / 100;
}

// ==============================================
// FUZZY (API pública) — UNIFICADO
// - Si alguien pasa "radius" viejo, lo mapea a radios.
// - Si pasa radios nuevos, usa radios nuevos.
// ==============================================

export function suggestMoveFromPatternsFuzzy(fen, side, opts = {}) {
  const { radius, ...rest } = opts || {};

  // Compatibilidad: si alguien pasa "radius" viejo,
  // lo convertimos a radios por feature.
  if (typeof radius === "number" && rest.radiusMd == null) {
    return suggestMoveFromSimilarPatterns(fen, side, {
      ...rest,
      radiusMd: radius,
      radiusMob: radius,
      radiusAdv: radius,
      radiusCd: radius,
      radiusKd: 0, // no mezclar damas por defecto
    });
  }

  return suggestMoveFromSimilarPatterns(fen, side, rest);
}
