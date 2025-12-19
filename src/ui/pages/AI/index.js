// ================================
// src/ui/pages/AI/index.js
// IA — Orquestador con Minimax (capturas + quiet + quiescence)
// + Patrones (exacto + fuzzy) validados vs motor
// ================================

import {
  SIZE, dark, startBoard, drawBoard,
  clearHints, hintMove, showFirstStepOptions, markRouteLabel, paintState,
  makeController, attachBoardInteractions,
  COLOR, colorOf, movimientos as baseMovimientos, aplicarMovimiento as baseAplicarMovimiento,
} from "@engine";

import { onMove, onCaptureHop } from "../../sfx.hooks.js";
import { mountLearningPanel } from "./ai.learning.panel.js";
import { initEditorSFX } from "../Training/editor/sfx.bootstrap.js";
import { ensureGlobalFX } from "../../kit/globalFX.js";

import "../../../styles/board.css";
import "../../../styles/board/cells.css";
import "../Training/editor/editor.fx.css";

import { animateCellMove } from "../../lib/ghostAnim.js";
import { triggerCapturedVanish } from "../../lib/uiFX.js";
import { isGhost } from "@rules";

import { minimaxChooseBestMove } from "../../../ai/minimax.js";
import { evaluate } from "../../../ai/eval.js";
import { pedirJugadaIA, enviarLogIA } from "../../api/ia.api.js";

import { mountTeachPanel } from "./ai.teach.panel.js";
import "./ai.teach.panel.css";
import "./ai.layout.css";

import("/src/ai/learning/trainer.js").then(m => m.trainModel());

import {
  loadPatternIndex,
  suggestMoveFromPatterns,
  suggestMoveFromPatternsFuzzy,
  enableServerPatternSync,
  pullPatternIndexFromServer,
} from "../../../ai/learning/patterns.js";

const FX_CAPTURE_MS = 2000;
const FX_MOVE_MS    = 220;

console.log("[PATTERN INDEX]", loadPatternIndex());
console.log("[PATTERN SUGGEST]", suggestMoveFromPatterns(startBoard, "R"));

// ✅ PASO 8: al entrar a IA, trae la memoria del backend y la deja en localStorage
(async () => {
  // Si tienes proxy Vite / mismo dominio, NO cambies base.
  enableServerPatternSync({ enabled: true, base: "/ai/patterns" });

  const pull = await pullPatternIndexFromServer();
  console.log("[PATTERN SYNC] pull", pull);

  // Re-log después del pull para ver el índice ya cargado desde disco
  console.log("[PATTERN INDEX AFTER PULL]", loadPatternIndex());
})();



async function bootstrapPatternSync() {
  // ✅ PASO 8: memoria persistente en backend (no depende de caché/localStorage)
  try {
    enableServerPatternSync({ baseUrl: "" }); // vacío = mismo origen / proxy Vite
  } catch {}

  try {
    const res = await pullPatternIndexFromServer({ merge: true });
    console.log("[PATTERN SYNC] pull OK", res);
  } catch (e) {
    console.warn("[PATTERN SYNC] pull falló (se seguirá con local)", String(e?.message || e));
  }
}


// ==============================================
// ✅ PASO 3/6: Validar sugerencias de patrones vs motor (@engine)
// ==============================================

function _rcToAlg10x10(rc) {
  if (!Array.isArray(rc) || rc.length < 2) return null;
  const [r, c] = rc;
  if (r == null || c == null) return null;
  const file = String.fromCharCode(97 + c); // 0..9 => a..j
  const rank = String(SIZE - r);            // r=0 => 10, r=9 => 1
  return (file + rank).toLowerCase();
}

function _routeToAlg(path) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const parts = [];
  for (const rc of path) {
    const a = _rcToAlg10x10(rc);
    if (!a) return null;
    parts.push(a);
  }
  return parts.join("-");
}

function _normalizeAlg(s) {
  return String(s || "").trim().toLowerCase();
}

/**
 * Construye el conjunto de jugadas legales (algebraicas) para un color:
 * - simples: "a3-b4"
 * - capturas: "a3-c5-e7"
 *
 * Basado 100% en baseMovimientos(board,[r,c]).
 */
function collectAllLegalAlgMoves(board, sideColor) {
  const set = new Set();

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const ch = board?.[r]?.[c] ?? null;
      if (!ch) continue;

      let chColor;
      try { chColor = colorOf(ch); } catch { continue; }
      if (chColor !== sideColor) continue;

      const from = [r, c];
      const fromAlg = _rcToAlg10x10(from);
      if (!fromAlg) continue;

      const mv = baseMovimientos(board, from) || {};

      // Simples
      const moves = mv.moves || mv.movs || mv.simple || [];
      if (Array.isArray(moves) && moves.length) {
        for (const m of moves) {
          if (!m) continue;
          const dest = m.to || m.dest || m.pos;
          if (!Array.isArray(dest) || dest.length < 2) continue;
          const toAlg = _rcToAlg10x10(dest);
          if (!toAlg) continue;
          set.add(`${fromAlg}-${toAlg}`);
        }
      }

      // Capturas (rutas)
      const caps = mv.captures || mv.capturas || mv.takes || [];
      if (Array.isArray(caps) && caps.length) {
        for (const rt of caps) {
          const path = (rt && (rt.path || rt.ruta || rt.steps)) || null;
          const alg = _routeToAlg(path);
          if (alg) set.add(alg);
        }
      }
    }
  }

  return set;
}

/**
 * Intenta encontrar UNA sugerencia de patrones que sea legal según el motor.
 * Retorna string "a3-b4-..." o null.
 *
 * Orden:
 * 1) suggestMoveFromPatterns (exacto)
 * 2) suggestMoveFromPatternsFuzzy (parecidos)
 */
function pickFirstLegalPatternSuggestion({ fen, side, legalSet }) {
  // 1) Exacto
  let s = suggestMoveFromPatterns(fen, side, { k: 5, minCount: 2, maxAgeDays: 180 });

  // 2) Fuzzy (parecidos)
  if (!s?.ok || !s.suggestions?.length) {
    s = suggestMoveFromPatternsFuzzy(fen, side, {
      k: 8,
      minCount: 2,
      maxAgeDays: 180,
      preferRecent: true,

      // radios por bucket (coincide con patterns.js)
      radiusMd: 2,
      radiusMob: 2,
      radiusAdv: 2,
      radiusCd: 1,
      radiusKd: 0,

      // límite de keys vecinas a evaluar
      maxCandidates: 120,
    });
  }

  if (!s?.ok || !s.suggestions?.length) return null;
  if (!legalSet || typeof legalSet.has !== "function") return null;

  for (const sug of s.suggestions) {
    const mv = _normalizeAlg(sug.move);
    if (legalSet.has(mv)) {
      console.log("[PATTERN✔] sugerencia legal encontrada", {
        key: s.key,
        move: mv,
        score: sug.score,
        count: sug.count,
        meta: s.meta || null
      });
      return mv;
    }
  }

  console.log("[PATTERN✘] hubo sugerencias, pero ninguna fue legal aquí", {
    key: s.key,
    suggestions: s.suggestions.map(x => x.move),
    legalCount: (legalSet?.size ?? 0),
    meta: s.meta || null
  });

  return null;
}

// ----------------------
// Debug IA (con flag)
// ----------------------
const DEBUG_IA =
  typeof window !== "undefined" &&
  typeof window.location !== "undefined" &&
  window.location.search.includes("debugIA=1");

function logIA(...args) {
  if (!DEBUG_IA) return;
  try { console.log(...args); } catch {}
}

function warnIA(...args) {
  if (!DEBUG_IA) return;
  try { console.warn(...args); } catch {}
}

// Cooldown / strikes para Python quiet
const PYTHON_QUIET_MAX_STRIKES       = 4;
const PYTHON_QUIET_COOLDOWN_TURNS    = 8;


// -------------------------------------------------------
// Coordenadas alfanuméricas en el tablero (A-J / 1-10)
// -------------------------------------------------------
function ensureAlgLabels(boardEl){
  if (!boardEl) return;
  try{
    const cells = boardEl.querySelectorAll('[data-r][data-c]');
    if (!cells || !cells.length) return;
    for (const el of cells){
      const r = Number(el.getAttribute('data-r'));
      const c = Number(el.getAttribute('data-c'));
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      const file = String.fromCharCode(97 + c); // a..j
      const rank = String(SIZE - r);
      const coord = (file + rank).toUpperCase();
      el.setAttribute('data-coord', coord);
      let lab = el.querySelector(':scope > .alg-label');
      if (!lab){
        lab = document.createElement('span');
        lab.className = 'alg-label';
        el.appendChild(lab);
      }
      lab.textContent = coord;
    }
  }catch{}
}

// -------------------------------------------------------
// Helpers de tablero
// -------------------------------------------------------
function cloneBoard(b){ return b.map(r => r.slice()); }

function crownIfNeeded(b, to){
  try{
    const [r,c] = to;
    const piece = b[r][c];
    if (piece === "r" && r === 0) b[r][c] = "R";
    if (piece === "n" && r === SIZE - 1) b[r][c] = "N";
  }catch{}
}

function routeHasCapture(route){
  const caps = route?.captures || route?.capturas || route?.takes || [];
  return Array.isArray(caps) && caps.length > 0;
}

function ringColorFor(ch){
  try { return colorOf(ch) === COLOR.NEGRO ? "#FFFFFF" : "#0e0d0dff"; }
  catch { return "#FFFFFF"; }
}

function diagPassCells(from, to){
  const [fr, fc] = from, [tr, tc] = to;
  const dr = Math.sign(tr - fr), dc = Math.sign(tc - fc);
  const cells = []; let r = fr + dr, c = fc + dc;
  while (r !== tr && c !== tc){ cells.push([r,c]); r += dr; c += dc; }
  return cells;
}

function findMidOnCurrentBoard(b, from, to){
  const cells = diagPassCells(from, to);
  let mid = null; let count = 0;
  for (const [r, c] of cells){
    const ch = b[r][c];
    if (ch && !isGhost(ch)) { count++; mid = [r, c]; }
  }
  return count === 1 ? mid : null;
}

function ringOnNextGhost(pieceChar, { duration = 800 } = {}) {
  const color = (colorOf(pieceChar) === COLOR.NEGRO) ? "#FFFFFF" : "#0e0d0dff";
  const apply = (el) => {
    if (!el) return;
    el.querySelectorAll('[data-ghost-ring]').forEach(n => n.remove());
    const ring = document.createElement('div');
    ring.setAttribute('data-ghost-ring', '');
    Object.assign(ring.style, {
      position: 'absolute', inset: '-4px', borderRadius: '50%',
      pointerEvents: 'none', boxShadow: `0 0 0 6px ${color}`, zIndex: '2'
    });
    const prevPos = el.style.position;
    if (!prevPos || prevPos === 'static') el.style.position = 'relative';
    el.appendChild(ring);
    window.setTimeout(() => {
      ring.remove();
      if (!prevPos || prevPos === 'static') {
        el.style.position = prevPos || '';
      }
    }, duration);
  };
  const now = document.querySelector('.ghost-layer .piece');
  if (now) { apply(now); return; }
  const obs = new MutationObserver(() => {
    const el = document.querySelector('.ghost-layer .piece');
    if (el) { apply(el); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 1200);
}

function fallbackSingleCapture(board, from, to){
  const nb = board.map(r => r.slice());
  const [fr, fc] = from; const [tr, tc] = to;
  const piece = nb[fr][fc]; if (!piece) return nb;
  const stepR = tr > fr ? 1 : -1; const stepC = tc > fc ? 1 : -1;
  let r = fr + stepR, c = fc + stepC; let capR = null, capC = null;
  while (r !== tr && c !== tc){
    if (nb[r][c]) { capR = r; capC = c; break; }
    r += stepR; c += stepC;
  }
  nb[tr][tc] = piece;
  nb[fr][fc] = null;
  if (capR != null && capC != null) nb[capR][capC] = null;
  crownIfNeeded(nb, [tr, tc]);
  return nb;
}

function doHop(board, from, to){
  try { onCaptureHop(); } catch {}
  return fallbackSingleCapture(board, from, to);
}

// === Movimiento simple directo para jugadas tranquilas (Python/patrones) ===
function simpleMove(board, from, to){
  const nb = board.map(r => r.slice());
  const [fr, fc] = from || [];
  const [tr, tc] = to   || [];
  const piece = (nb?.[fr]?.[fc]) ?? null;

  if (!piece) {
    try {
      warnIA("[IA] simpleMove: no hay pieza en 'from'", {
        from, to,
        filaFrom: JSON.stringify(nb[fr] || null)
      });
    } catch {}
    return nb;
  }

  nb[fr][fc] = null;
  nb[tr][tc] = piece;
  crownIfNeeded(nb, [tr, tc]);

  logIA("[IA] simpleMove aplicado (IA):", {
    from, to, piece,
    rowFromAfter: nb[fr] ? [...nb[fr]] : null,
    rowToAfter:   nb[tr] ? [...nb[tr]] : null
  });

  return nb;
}

// -------------------------------------------------------
// ✅ PASO CLAVE: Diagnóstico + Auto-ajuste de mapeo (Python -> board)
// -------------------------------------------------------
function flipY(rc){
  if (!Array.isArray(rc) || rc.length < 2) return rc;
  return [SIZE - 1 - rc[0], rc[1]];
}
function flipX(rc){
  if (!Array.isArray(rc) || rc.length < 2) return rc;
  return [rc[0], SIZE - 1 - rc[1]];
}
function flipXY(rc){
  if (!Array.isArray(rc) || rc.length < 2) return rc;
  return [SIZE - 1 - rc[0], SIZE - 1 - rc[1]];
}
function piezaEn(b, rc){
  const [r,c] = rc || [];
  return (b?.[r]?.[c]) ?? null;
}
function esMia(ch, sideColor){
  try { return !!ch && colorOf(ch) === sideColor; } catch { return false; }
}

/**
 * Intenta encontrar una transformación de coordenadas (id/flipY/flipX/flipXY)
 * para que:
 *  - exista pieza en from
 *  - esa pieza sea del color de la IA (aiSide)
 *  - destino esté vacío
 *
 * Devuelve { from, to, mapping, piece, dest } o null.
 */
function resolverCoordsPython(board, from, to, aiSide){
  const candidates = [
    { name: "id",    tx: (rc) => rc },
    { name: "flipY", tx: flipY },
    { name: "flipX", tx: flipX },
    { name: "flipXY", tx: flipXY },
  ];

  // 1) Mejor caso: pieza existe, es mía, y destino vacío
  for (const cand of candidates){
    const f = cand.tx(from);
    const t = cand.tx(to);
    const p = piezaEn(board, f);
    const d = piezaEn(board, t);
    if (p && esMia(p, aiSide) && !d) {
      return { from: f, to: t, mapping: cand.name, piece: p, dest: d };
    }
  }

  // 2) Caso fallback: pieza existe (aunque no sepamos color), destino vacío
  for (const cand of candidates){
    const f = cand.tx(from);
    const t = cand.tx(to);
    const p = piezaEn(board, f);
    const d = piezaEn(board, t);
    if (p && !d) {
      return { from: f, to: t, mapping: cand.name, piece: p, dest: d };
    }
  }

  return null;
}

// -------------------------------------------------------
// Algebraicas
// -------------------------------------------------------
function parseAlgebraicCoord(token){
  if (!token || typeof token !== "string") return null;
  const s = token.trim();
  const m = /^([a-j])(10|[1-9])$/i.exec(s);
  if (!m) return null;

  const colMap = { a:0, b:1, c:2, d:3, e:4, f:5, g:6, h:7, i:8, j:9 };
  const col = colMap[m[1].toLowerCase()];
  const rowNum = parseInt(m[2], 10);

  if (col == null || isNaN(rowNum)) return null;

  // Convención del FRONTEND: row 0 es la fila 10 (arriba) y row 9 es la fila 1 (abajo)
  const row = SIZE - rowNum;

  if (row < 0 || row >= SIZE) return null;
  return [row, col];
}

function parseAlgebraicMove(str){
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  const m = /^([a-j])(10|[1-9])-([a-j])(10|[1-9])$/i.exec(s);
  if (!m) return null;
  const from = parseAlgebraicCoord(m[1] + m[2]);
  const to   = parseAlgebraicCoord(m[3] + m[4]);
  if (!from || !to) return null;
  return { from, to };
}

function parseAlgebraicRoute(str){
  if (!str || typeof str !== "string") return null;
  const parts = str.split("-").map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const route = [];
  for (const p of parts){
    const coord = parseAlgebraicCoord(p);
    if (!coord) return null;
    route.push(coord);
  }
  return route;
}

// -------------------------------------------------------
// Validación contra motor JS
// -------------------------------------------------------
function rutasIguales(pathA, pathB){
  if (!Array.isArray(pathA) || !Array.isArray(pathB)) return false;
  if (pathA.length !== pathB.length) return false;
  for (let i = 0; i < pathA.length; i++){
    const a = pathA[i] || [];
    const b = pathB[i] || [];
    if (a[0] !== b[0] || a[1] !== b[1]) return false;
  }
  return true;
}

function rutaCoincideConCapturasMotor(board, path){
  if (!Array.isArray(path) || path.length < 2) return false;
  const origin = path[0];
  if (!Array.isArray(origin) || origin.length < 2) return false;

  const mv = baseMovimientos(board, origin) || {};
  const caps = mv.captures || mv.capturas || mv.takes || [];
  if (!Array.isArray(caps) || !caps.length) return false;

  for (const rt of caps){
    const rPath = (rt && (rt.path || rt.ruta || rt.steps)) || null;
    if (Array.isArray(rPath) && rutasIguales(rPath, path)) {
      return true;
    }
  }
  return false;
}

function movimientoCoincideConMotor(board, from, to){
  if (!Array.isArray(from) || from.length < 2) return false;
  if (!Array.isArray(to)   || to.length   < 2) return false;

  const mv = baseMovimientos(board, from) || {};
  const moves = mv.moves || mv.movs || mv.simple || [];

  const piece = (board?.[from[0]]?.[from[1]]) ?? null;

  logIA("[IA] DEBUG movimientoCoincideConMotor:", {
    from,
    to,
    piece,
    mv,
    simpleMoves: moves
  });

  if (!piece) {
    try {
      warnIA("[IA] movimientoCoincideConMotor: no hay pieza en 'from'; se rechaza jugada.", {
        from,
        to,
        filaBoard: JSON.stringify(board[from[0]] || null)
      });
    } catch {}
    return false;
  }

  if (!Array.isArray(moves) || moves.length === 0) {
    // fallback permisivo (como ya tenías)
    return true;
  }

  for (const m of moves){
    if (!m) continue;
    const dest = m.to || m.dest || m.pos;
    if (Array.isArray(dest) && dest[0] === to[0] && dest[1] === to[1]) {
      return true;
    }
  }

  return false;
}

// -------------------------------------------------------
// Sanitizador de ruta contra “doble vía”
// -------------------------------------------------------
function sanitizeCapturePathAgainstDoubleVia(board, path){
  if (!Array.isArray(path) || path.length < 2) return null;

  const b = cloneBoard(board);
  const start = path[0];
  const piece = b?.[start[0]]?.[start[1]];
  if (!piece) return null;

  let myColor;
  try { myColor = colorOf(piece); } catch { return null; }

  const capturedSquares = [];

  for (let i = 0; i < path.length - 1; i++){
    const from = path[i];
    const to   = path[i + 1];

    const cells = diagPassCells(from, to);
    if (!cells.length) return null;

    let mid = null;
    for (const [r, c] of cells){
      const ch = b?.[r]?.[c];
      if (!ch || isGhost(ch)) continue;
      let chColor;
      try { chColor = colorOf(ch); } catch { continue; }
      if (chColor !== myColor){
        mid = [r, c];
        break;
      }
    }
    if (!mid) return null;

    const repiteIntermedia = cells.some(([r, c]) =>
      capturedSquares.some(([cr, cc]) => cr === r && cc === c)
    );
    const repiteDestino = capturedSquares.some(
      ([cr, cc]) => cr === to[0] && cc === to[1]
    );

    if (repiteIntermedia || repiteDestino){
      if (i === 0) return null;
      const trimmed = path.slice(0, i + 1);
      logIA("[IA] Ruta recortada para evitar doble vía:", path, "→", trimmed);
      return trimmed;
    }

    capturedSquares.push(mid);

    const [fr, fc] = from;
    const [mr, mc] = mid;
    const [tr, tc] = to;
    b[fr][fc] = null;
    b[mr][mc] = null;
    b[tr][tc] = piece;
    crownIfNeeded(b, [tr, tc]);
  }

  return path;
}

// -------------------------------------------------------
// Componente principal IA
// -------------------------------------------------------
export default function mountAI(container){
  if (!container) return;

  try { document.body.dataset.page = "ai"; } catch {}

  initEditorSFX();
  ensureGlobalFX();

  // ✅ PASO 8: sincroniza patrones desde backend al iniciar
  bootstrapPatternSync();

  // Imports dinámicos de logMoves / trainer
  let recordMove = null;
  let trainModel = null;
  import("../../../ai/learning/logMoves.js").then(m => { recordMove = m.recordMove; }).catch(()=>{});
  import("../../../ai/learning/trainer.js").then(m => { trainModel = m.trainModel; }).catch(()=>{});

  let board = startBoard();
  let turn  = COLOR.ROJO;
  let stepState = null;

  let placing = null;
  const undoStack = [];

  let aiSide   = COLOR.NEGRO;
  let thinking = false;

  // Strikes / cooldown de Python quiet
  let pythonQuietStrikes  = 0;
  let pythonQuietCooldown = 0;

  function anyCaptureAvailableFor(color){
    for (let r=0; r<SIZE; r++){
      for (let c=0; c<SIZE; c++){
        const ch = board[r][c];
        if (!ch) continue;
        if (colorOf(ch) !== color) continue;
        const mv = baseMovimientos(board, [r, c]) || {};
        const caps = mv.captures || mv.capturas || mv.takes || [];
        if (Array.isArray(caps) && caps.length) return true;
      }
    }
    return false;
  }

  function movimientosForced(...args){ return baseMovimientos(...args) || {}; }

  function aplicarMovimientoForced(b, payload){
    const nb = baseAplicarMovimiento(b, payload);
    try { crownIfNeeded(nb, payload?.to); } catch {}
    return nb;
  }
  // === UI ===
  container.innerHTML = `
    <div class="ai-page">
      <h2 style="margin:0 0 10px 0;">Jugar contra la IA</h2>

      <div class="ai-layout">
        <!-- Panel izquierdo -->
        <div class="ai-side ai-side--left">
          <div class="ai-panel" id="ai-left">
            <div class="ai-panel-title">Controles</div>
            <div class="ai-stack">
              <button class="btn" id="btn-empty">Vaciar</button>
              <button class="btn" id="btn-init">Inicial</button>
              <button class="btn" id="btn-turn">Turno</button>
              <button class="btn" id="btn-undo">Deshacer</button>
              <button class="btn" id="btn-restart">Reiniciar</button>

              <label class="btn btn--subtle" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <span>Lado IA</span>
                <select id="ai-side" style="padding:.4rem .6rem; border-radius:.5rem;">
                  <option value="N" selected>Negro</option>
                  <option value="R">Rojo</option>
                </select>
              </label>

              <span id="turn-info" class="btn btn--subtle">Turno: —</span>
              <span id="ai-info" class="btn btn--subtle">IA: —</span>
              <span id="capture-info" class="btn btn--subtle" style="display:none;">Captura obligatoria (humano)</span>
            </div>
          </div>
        </div>

        <!-- Centro: tablero -->
        <div class="ai-center">
          <div class="card">
            <div id="board"></div>
          </div>
        </div>

        <!-- Panel derecho -->
        <div class="ai-side ai-side--right">
          <div class="ai-panel" id="ai-right">
            <div class="ai-panel-title">Piezas</div>
            <div class="ai-stack">
              <span id="place-info" class="btn btn--subtle" style="display:none;">Modo colocar</span>
              <button class="btn" id="btn-eraser">Borrador</button>
              <button class="btn" id="btn-man-r">Peón ROJO</button>
              <button class="btn" id="btn-queen-r">Dama ROJA</button>
              <button class="btn" id="btn-man-n">Peón NEGRO</button>
              <button class="btn" id="btn-queen-n">Dama NEGRA</button>
            </div>
          </div>

          <!-- Panel aprendizaje (tech) -->
          <div class="ai-panel" id="ai-learning-panel">
            <div class="ai-panel-title">Aprendizaje</div>
            <div id="ai-learning-mount"></div>
          </div>

          <!-- ✅ Panel minimalista: guardar jugada correcta -->
          <div id="ai-teach-mount"></div>
        </div>
      </div>
    </div>
  `;


  const $toolbar     = container.querySelector("#ai-learning-mount");
  const $boardEl     = container.querySelector("#board");
  const $turnInfo    = container.querySelector("#turn-info");
  const $aiInfo      = container.querySelector("#ai-info");
  const $placeInfo   = container.querySelector("#place-info");
  const $captureInfo = container.querySelector("#capture-info");

  const $teachMount  = container.querySelector("#ai-teach-mount");

  const $btnEmpty   = container.querySelector("#btn-empty");
  const $btnInit    = container.querySelector("#btn-init");
  const $btnTurn    = container.querySelector("#btn-turn");
  const $btnUndo    = container.querySelector("#btn-undo");
  const $btnEraser  = container.querySelector("#btn-eraser");
  const $btnManR    = container.querySelector("#btn-man-r");
  const $btnManN    = container.querySelector("#btn-man-n");
  const $btnQueenR  = container.querySelector("#btn-queen-r");
  const $btnQueenN  = container.querySelector("#btn-queen-n");
  const $btnRestart = container.querySelector("#btn-restart");
  const $aiSideSel  = container.querySelector("#ai-side");

  // Panel aprendizaje IA
  if ($toolbar) {
    mountLearningPanel({
      toolbarEl: $toolbar,
      getFen: () => {
        try {
          if (typeof __D10 !== "undefined" && __D10?.fen) return __D10.fen();
        } catch {}
        return JSON.stringify(board);
      },
      getRecordMove: () => recordMove,
      getTrainModel: () => trainModel,
    });
  }

  // =====================================
  // ✅ Panel "Enseñar a la IA" (feedback)
  // =====================================
  const teachState = {
    // Se llena al hacer Undo de una jugada de la IA
    pending: null,
    awaitingCorrect: false,

    // Contexto de la última jugada de la IA
    lastAiSide: null,      // "R" | "N"
    lastAiBoard: null,     // board 10x10 (antes de que la IA jugara)
  };

  // diff simple: intenta inferir "from-to" desde cambio de tablero
  function inferMoveAlgFromDiff(prevBoard, nextBoard) {
    try {
      if (!Array.isArray(prevBoard) || !Array.isArray(nextBoard)) return null;
      let from = null;
      let to = null;

      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const a = prevBoard?.[r]?.[c] ?? null;
          const b = nextBoard?.[r]?.[c] ?? null;
          if (a === b) continue;
          // salida de una ficha
          if (a && !b) from = [r, c];
          // llegada de una ficha
          if (!a && b) to = [r, c];
          // coronación: ficha cambia en destino (tratamos como destino)
          if (a && b && a !== b) {
            // si antes estaba vacía y ahora hay pieza no aplica; pero aquí puede ser cambio de pieza
            // no podemos inferir to con seguridad; lo dejamos
          }
        }
      }

      if (!from || !to) return null;
      const fa = _rcToAlg10x10(from);
      const ta = _rcToAlg10x10(to);
      if (!fa || !ta) return null;
      return `${fa}-${ta}`;
    } catch {
      return null;
    }
  }

  // Montaje del panel (si existe el mount)
  const teachPanel = $teachMount
    ? mountTeachPanel({
        mountPoint: $teachMount,
        getState: () => teachState,
        onTeach: async (p) => {
          // Guardamos como experiencia (JSONL) en backend
          const entry = {
            ts: Date.now(),
            board: p.board,
            side: p.side,
            move: p.correct_move,
            score: 1.0,
          };
          const res = await enviarLogIA([entry]);

          // limpiar estado
          teachState.pending = null;
          teachState.awaitingCorrect = false;
          teachState.lastAiBoard = null;

          try { teachPanel?.refresh?.(); } catch {}
          return res;
        },
      })
    : null;

  function render(){ drawBoard($boardEl, board, SIZE, dark); ensureAlgLabels($boardEl); }

  function setCaptureInfo() {
    const isHumanTurn = turn !== aiSide;
    const must = isHumanTurn && anyCaptureAvailableFor(turn);
    $captureInfo.style.display = must ? "inline-flex" : "none";
  }

  function setTurnText(){
    $turnInfo.textContent = `Turno: ${turn === COLOR.ROJO ? "ROJO" : "NEGRO"}`;
    setCaptureInfo();
  }

  function setAiText(){
    $aiInfo.textContent = thinking ? "IA: pensando…" : `IA: ${aiSide === COLOR.ROJO ? "ROJO" : "NEGRO"}`;
    setCaptureInfo();
  }

  const baseCtx = {
    SIZE, container,
    getBoard: () => board,
    setBoard: (b) => {
      const prev = board;
      board = b;

      // Si estamos en modo "enseñar" (tras Undo), intentamos inferir
      // la jugada correcta desde el cambio de tablero.
      try {
        const p = teachState?.pending;
        if (teachState?.awaitingCorrect && p && !p.correct_move) {
          const mv = inferMoveAlgFromDiff(prev, b);
          if (mv) {
            p.correct_move = mv;
            teachState.awaitingCorrect = false;
            teachPanel?.refresh?.();
          }
        }
      } catch {}
    },
    getTurn:  () => turn,
    setTurn:  (t) => { turn = t; setTurnText(); setAiText(); maybeAi(); },
    getStepState: () => stepState,
    setStepState: (s) => { stepState = s; },
    getPlacing: () => placing,
    render,
    paintState: () => paintState({
      boardEl: $boardEl, board, turn,
      setTurn: (t) => { turn = t; setTurnText(); setAiText(); maybeAi(); },
      stepState, setStepState: (s) => { stepState = s; },
      container, showDebug: false
    }),
    saveForUndo: () => {
      undoStack.push(cloneBoard(board));
      if (undoStack.length > 100) undoStack.shift();
    },
    rules: { colorOf, movimientos: movimientosForced, aplicarMovimiento: aplicarMovimientoForced },
    deps:  { movimientos: movimientosForced, aplicarMovimiento: aplicarMovimientoForced, rules: { colorOf } },
    hints: { clearHints, hintMove, showFirstStepOptions, markRouteLabel },
    onTurnChange: () => { setTurnText(); setAiText(); maybeAi(); },
  };

  const baseController = makeController({
    container,
    getBoard: baseCtx.getBoard,
    setBoard: baseCtx.setBoard,
    getTurn:  baseCtx.getTurn,
    setTurn:  baseCtx.setTurn,
    getStepState: baseCtx.getStepState,
    setStepState: baseCtx.setStepState,
    render: baseCtx.render,
    paintState: baseCtx.paintState,
    deps:  baseCtx.deps,
    hints: baseCtx.hints,
  });

  const controller = {
    ...baseController,
    continueOrEndChain: (route, ...rest) => {
      if (anyCaptureAvailableFor(turn) && !routeHasCapture(route)) return;
      return baseController.continueOrEndChain?.(route, ...rest);
    }
  };
  const ctx = { ...baseCtx, controller };

  try {
    container.rules = { colorOf, movimientos: movimientosForced, aplicarMovimiento: aplicarMovimientoForced };
    window.__rules  = Object.assign({}, window.__rules || {}, container.rules);
  } catch {}

  render(); setTurnText(); setAiText(); ctx.paintState();
  try { attachBoardInteractions(container, ctx); } catch {}

  // =======================
  // Lógica de la IA
  // =======================
  async function doAiMove(){
    if (thinking) return;
    thinking = true; setAiText();
    await new Promise(res => setTimeout(res, FX_MOVE_MS));

    try {
      let best = null;

      const fenCurrent =
        typeof __D10 !== "undefined" && __D10?.fen
          ? __D10.fen()
          : JSON.stringify(board);

      const sideCode = aiSide === COLOR.ROJO ? "R" : "N";

      // ✅ Enseñanza: guardamos el tablero ANTES de que la IA juegue
      // para que el usuario pueda hacer Undo y enseñarle la jugada correcta.
      try {
        teachState.lastAiSide = sideCode;
        teachState.lastAiBoard = cloneBoard(board);

        // también guardamos para Undo (así el botón deshacer revierte la jugada de la IA)
        undoStack.push(cloneBoard(board));
        if (undoStack.length > 100) undoStack.shift();
      } catch {}

      const hayCapturasAI = anyCaptureAvailableFor(aiSide);

      // ✅ Debug Paso 3: validar si hay sugerencia legal (solo log)
      try {
        const legalSet = collectAllLegalAlgMoves(board, aiSide);
        const mvPatternDebug = pickFirstLegalPatternSuggestion({ fen: fenCurrent, side: sideCode, legalSet });
        if (mvPatternDebug) logIA("[PATTERN] (debug) sugerencia legal del patrón:", mvPatternDebug);
      } catch (e) {
        console.warn("[PATTERN] error validando sugerencias (debug)", e);
      }

      if (hayCapturasAI) {
        // Capturas -> SOLO minimax JS
        logIA("[IA] Capturas disponibles para IA → usar SOLO minimax JS");
        best = minimaxChooseBestMove(
          board,
          aiSide,
          6,
          {
            COLOR, SIZE, colorOf,
            movimientos: baseMovimientos,
            aplicarMovimiento: baseAplicarMovimiento,
            crownIfNeeded,
            evaluate
          },
          {
            rootCaptureOnly: true,
            quiescence: true,
            useSEE: true,
            seePenaltyMargin: -0.08,
            timeMs: 900
          }
        );
        if (best) best.origin = "js";
      } else {
        // ✅ PASO 6: si NO hay capturas, intentar patrones (fuzzy) ANTES de Python/minimax
        try {
          const legalSet = collectAllLegalAlgMoves(board, aiSide);
          const mvPattern = pickFirstLegalPatternSuggestion({ fen: fenCurrent, side: sideCode, legalSet });

          if (mvPattern) {
            const route = parseAlgebraicRoute(mvPattern);
            if (route && route.length >= 2) {
              if (route.length === 2) {
                best = { type: "move", from: route[0], to: route[1], origin: "pattern" };
              } else {
                best = { type: "capture", path: route, origin: "pattern" };
              }
              logIA("[PATTERN] ✅ usando sugerencia de patrón (legal) como jugada:", best);
            }
          }
        } catch (e) {
          console.warn("[PATTERN] error aplicando patrones (Paso 6)", e);
        }

        // Si NO hubo patrón usable -> intentar Python quiet -> fallback minimax
        if (!best) {
          let pythonTried = false;

          if (pythonQuietCooldown > 0) {
            logIA("[IA] Python quiet deshabilitado temporalmente. Restan turnos:", pythonQuietCooldown);
            pythonQuietCooldown--;
          } else {
            pythonTried = true;

            try {
              logIA("[IA] (Python) Enviando posición al backend (quiet):", {
                sideCode,
                fenPreview: typeof fenCurrent === "string" ? fenCurrent.slice(0, 80) : fenCurrent,
              });

              // enviar (fen, side, board) para evitar 422
              const respuesta = await pedirJugadaIA(fenCurrent, sideCode, board);

              logIA("[IA] (Python) Sugerencia recibida:", respuesta);

              if (respuesta && typeof respuesta.move === "string") {
                const route = parseAlgebraicRoute(respuesta.move);

                // Si viene como ruta
                if (route && route.length >= 2) {
                  const fromRaw = route[0];
                  const toRaw   = route[route.length - 1];

                  // Detectar si parece captura por geometría + mid (aunque "quiet")
                  let isCapture = false;
                  for (let i = 0; i < route.length - 1; i++) {
                    const f = route[i];
                    const t = route[i + 1];
                    const dr = t[0] - f[0];
                    const dc = t[1] - f[1];
                    if (Math.abs(dr) === 2 && Math.abs(dc) === 2) {
                      const mid = findMidOnCurrentBoard(board, f, t);
                      if (mid) { isCapture = true; break; }
                    }
                  }

                  if (!isCapture) {
                    const resolved = resolverCoordsPython(board, fromRaw, toRaw, aiSide);
                    const from = resolved?.from || fromRaw;
                    const to   = resolved?.to   || toRaw;

                    const pieceBoard = board?.[from[0]]?.[from[1]] || null;
                    const destBoard  = board?.[to[0]]?.[to[1]]     || null;

                    const esValida = movimientoCoincideConMotor(board, from, to);

                    if (pieceBoard && !destBoard && esValida) {
                      best = { type: "move", from, to, origin: "python", mapping: resolved?.mapping || "id" };
                      logIA("[IA] Usando jugada de Python (quiet, validada):", best);
                    } else {
                      logIA("[IA] Python quiet descartada (pieza/destino/validez):", {
                        move: respuesta.move, fromRaw, toRaw, from, to,
                        mapping: resolved?.mapping || "id",
                        pieceBoard, destBoard, esValida
                      });
                    }
                  } else {
                    logIA("[IA] Python sugirió captura pero JS dice que no hay capturas. Se descarta.");
                  }
                } else {
                  // Si viene como move simple "a3-b4"
                  const parsed = parseAlgebraicMove(respuesta.move);
                  if (parsed) {
                    const resolved = resolverCoordsPython(board, parsed.from, parsed.to, aiSide);
                    const from = resolved?.from || parsed.from;
                    const to   = resolved?.to   || parsed.to;

                    const pieceBoard = board?.[from[0]]?.[from[1]] || null;
                    const destBoard  = board?.[to[0]]?.[to[1]]     || null;

                    const esValida = movimientoCoincideConMotor(board, from, to);

                    if (pieceBoard && !destBoard && esValida) {
                      best = { type: "move", from, to, origin: "python", mapping: resolved?.mapping || "id" };
                      logIA("[IA] Usando jugada de Python (simple, validada):", best);
                    } else {
                      logIA("[IA] Python simple descartada (pieza/destino/validez):", {
                        move: respuesta.move,
                        rawFrom: parsed.from, rawTo: parsed.to,
                        from, to, mapping: resolved?.mapping || "id",
                        pieceBoard, destBoard, esValida
                      });
                    }
                  } else {
                    logIA("[IA] No se pudo parsear respuesta.move:", respuesta.move);
                  }
                }
              }

            } catch (err) {
              warnIA("[IA] (Python) Error al llamar a pedirJugadaIA:", err);
            }

            if (pythonTried) {
              if (best && best.origin === "python") {
                pythonQuietStrikes = 0;
              } else {
                pythonQuietStrikes++;
                logIA("[IA] Python quiet sin jugada usable. Strikes consecutivos:", pythonQuietStrikes);
                if (pythonQuietStrikes >= PYTHON_QUIET_MAX_STRIKES) {
                  logIA("[IA] Deshabilitando temporalmente Python quiet por exceso de sugerencias inválidas.");
                  pythonQuietCooldown = PYTHON_QUIET_COOLDOWN_TURNS;
                  pythonQuietStrikes = 0;
                }
              }
            }
          }

          if (!best) {
            logIA("[IA] Sin jugada usable (patrón/Python quiet), usando minimax JS.");
            best = minimaxChooseBestMove(
              board,
              aiSide,
              6,
              {
                COLOR, SIZE, colorOf,
                movimientos: baseMovimientos,
                aplicarMovimiento: baseAplicarMovimiento,
                crownIfNeeded,
                evaluate
              },
              {
                rootCaptureOnly: false,
                quiescence: true,
                useSEE: true,
                seePenaltyMargin: -0.08,
                timeMs: 900
              }
            );
            if (best) best.origin = "js";
          }
        }
      }

      // Sanity-check SOLO para jugadas que NO vienen de Python
      if (
        best &&
        best.origin !== "python" &&
        best.from && best.to &&
        (
          !board[best.from[0]] ||
          !board[best.from[0]][best.from[1]]
        )
      ) {
        logIA("[IA] Jugada elegida no encaja con tablero actual, usando minimax JS como respaldo.");

        const fallback = minimaxChooseBestMove(
          board,
          aiSide,
          6,
          {
            COLOR, SIZE, colorOf,
            movimientos: baseMovimientos,
            aplicarMovimiento: baseAplicarMovimiento,
            crownIfNeeded,
            evaluate
          },
          {
            rootCaptureOnly: anyCaptureAvailableFor(aiSide),
            quiescence: true,
            useSEE: true,
            seePenaltyMargin: -0.08,
            timeMs: 900
          }
        );
        if (fallback) {
          fallback.origin = "js";
          best = fallback;
        }
      }

      if (!best) {
        turn = (turn === COLOR.ROJO) ? COLOR.NEGRO : COLOR.ROJO;
        render(); ctx.paintState(); setTurnText(); setAiText();
        logIA("[IA] Sin jugada best; solo cambio de turno.");
        return;
      }

      if (best.type === "capture") {
        let path = best.path;
        const sanitized = sanitizeCapturePathAgainstDoubleVia(board, path);

        if (sanitized && sanitized.length >= 2) {
          if (sanitized.length < path.length) {
            logIA("[IA] Ruta de captura recortada para evitar doble vía:", path, "→", sanitized);
          }
          path = sanitized;
        }

        try { onMove(); } catch {}
        for (let i=0; i<path.length-1; i++){
          const from = path[i], to = path[i+1];
          const mid = findMidOnCurrentBoard(board, from, to);
          const chFrom = board?.[from[0]]?.[from[1]] || null;
          ringOnNextGhost(chFrom, { duration: 800 });
          await animateCellMove($boardEl, from, to, { pieceChar: chFrom, ringColor: ringColorFor(chFrom), lift: 10 });
          if (mid) triggerCapturedVanish($boardEl, mid, { duration: FX_CAPTURE_MS });
          board = doHop(board, from, to);
        }
      } else {
        const m = best;
        const chFrom = board?.[m.from[0]]?.[m.from[1]] || null;
        try { onMove(); } catch {}
        ringOnNextGhost(chFrom, { duration: 800 });

        await animateCellMove($boardEl, m.from, m.to, { pieceChar: chFrom, lift: 10 });
        board = simpleMove(board, m.from, m.to);

        logIA("[IA] simpleMove aplicado (IA):", {
          from: m.from,
          to: m.to,
          piece: chFrom,
          mapping: m.mapping || null,
          origin: m.origin || null
        });
      }

      stepState = null;
      turn = (turn === COLOR.ROJO) ? COLOR.NEGRO : COLOR.ROJO;
      render(); ctx.paintState(); setTurnText(); setAiText();

    } catch(e){
      console.warn("[IA] fallo aplicando jugada:", e);
    } finally {
      thinking = false; setAiText();
    }
  }

  function maybeAi(){
    const sel = $aiSideSel?.value || "N";
    aiSide = (sel === "R") ? COLOR.ROJO : COLOR.NEGRO;

    if (turn === aiSide && !thinking) {
      doAiMove();
    }
  }

  // Botones y edición
  function repaint(){ ctx.setBoard(board); render(); ctx.paintState(); setCaptureInfo(); }

  $btnRestart?.addEventListener("click", () => {
    board = startBoard();
    stepState = null;
    turn = COLOR.ROJO;
    render();
    ctx.paintState();
    setTurnText();
    setAiText();
    maybeAi();
  });

  $aiSideSel?.addEventListener("change", () => { maybeAi(); setCaptureInfo(); });

  $btnEmpty?.addEventListener("click", () => {
    ctx.saveForUndo();
    board = Array.from({length: SIZE}, () => Array.from({length: SIZE}, () => null));
    repaint();
  });

  $btnInit?.addEventListener("click", () => {
    ctx.saveForUndo();
    board = startBoard();
    repaint();
  });

  $btnTurn?.addEventListener("click", () => {
    turn = (turn === COLOR.ROJO) ? COLOR.NEGRO : COLOR.ROJO;
    setTurnText();
    setAiText();
    ctx.paintState();
    maybeAi();
  });

  $btnUndo?.addEventListener("click", () => {
    const prev = undoStack.pop();
    if (prev){
      board = prev;
      repaint();

      // ✅ Si la última jugada fue de la IA, permitir modo "enseñar":
      // - Undo vuelve al tablero antes de la jugada de la IA
      // - el usuario juega la correcta
      // - luego presiona "Enseñar"
      try {
        const side = teachState?.lastAiSide;
        if (side && Array.isArray(board) && board.length === 10) {
          teachState.pending = {
            board: cloneBoard(board),
            side,
            correct_move: "",
          };
          teachState.awaitingCorrect = true;
          teachPanel?.refresh?.();
        }
      } catch {}
    }
  });

  function setPlacingHandler(p){
    const mapBtn = { x:$btnEraser, r:$btnManR, n:$btnManN, R:$btnQueenR, N:$btnQueenN };
    placing = (placing === p) ? null : p;
    const map = { x:"Borrador", r:"Peón ROJO", n:"Peón NEGRO", R:"Dama ROJA", N:"Dama NEGRA" };
    $placeInfo.style.display = placing ? "inline-flex" : "none";
    $placeInfo.textContent   = placing ? `Modo colocar: ${map[placing]}` : "";
    [$btnEraser,$btnManR,$btnManN,$btnQueenR,$btnQueenN].forEach(b=>b?.classList.remove("btn--active"));
    if (placing) mapBtn[placing]?.classList.add("btn--active");
  }

  $btnEraser?.addEventListener("click", () => setPlacingHandler("x"));
  $btnManR?.addEventListener("click", () => setPlacingHandler("r"));
  $btnManN?.addEventListener("click", () => setPlacingHandler("n"));
  $btnQueenR?.addEventListener("click", () => setPlacingHandler("R"));
  $btnQueenN?.addEventListener("click", () => setPlacingHandler("N"));

  // Arranque
  setTurnText();
  setAiText();
  maybeAi();
}
