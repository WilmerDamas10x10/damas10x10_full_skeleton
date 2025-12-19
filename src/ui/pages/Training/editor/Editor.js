import { navigate } from "@router";
import { saveLocalAutoFrom } from "./services/snapshot.js";
import "./editor.responsive.css";
import { installAssetFallbacks } from "../../../lib/assetFallbacks.js";
import { pedirJugadaIA } from "../../../api/ia.api.js";

import {
  getEditorTemplate,
  applyButtonIcons,
  SIZE, dark, startBoard,
  drawBoard,
  applySingleCapture,
  clearHints, hintMove, showFirstStepOptions,
  clearHints as clearVerification,
  makeController,
} from "./index.js";
import { mountRotateBoardButton } from "./ui/rotate.board.js";
import { setupUndo } from "./state/undo.js";
import { sharePosition } from "./services/share.js";
import { setupToolbar, syncToolButtons } from "./ui/toolbar.js";
import { updateTurnUI } from "./ui/turn.js";
import { buildHints } from "./config/hints.js";
import { attachBoardInteractions as bindBoardInteractions } from "./interactions.js";
import { paintView } from "./view/paint.js";
import { initEditorChrome, setEditingFlag } from "./ui/setup.js";
import { setupResponsive } from "./ui/layout.js";
import { installPositionsPanel } from "./ui/panels/positionsPanel.js";
import { finalizeDeferred } from "../../../../engine/chain.js";
import { COLOR, colorOf, mejoresCapturasGlobal, movimientos, aplicarMovimiento, isGhost } from "@rules";
import { installReplayDevHook } from "./dev/replayHook.js";
import { boardForSaveRaw } from "./services/boardForSave.js";
import { installEditorWANPanel } from "./ui/panels/wan.panel.js";
import { getPolicy, setRulesVariant } from "../../../../engine/policies/config.js";
import { installVariantHints } from "../../../patches/variantHints.js";
import { installVariantBreadcrumbs, syncVariantToolTitles } from "./ui/patches/variantBreadcrumbs.js";
import "./ui/patches/sfx.onApplied.js";
// 🔊 SFX manager (modular, no crea botones)
import { initEditorSFX, sfx } from "./sfx.bootstrap.js";

// 🆕 FX globales (zoom/pulse) y UI helpers para zoom puntual
import { ensureGlobalFX } from "../../../kit/globalFX.js";
import { triggerPieceZoom } from "../../../lib/uiFX.js";

import "./ui/patches/cleanupEditorUI.js";
import "./editor.fx.css";
import "./buttons.css";
import "./ui/patches/fenDownload.js";
import { installGoldenButton } from "./ui/patches/goldenButton.js";

import "../../../design.css";
import { toast } from "./ui/toast.js";
import { applyEditorLayout } from "./quick-layout.editor.js";
import "./hide-ghosts.css";

// 🆕 WS Bridge para sincronizar FEN/estado por WebSocket
import { createEditorWSBridge } from "./bridge/ws.bridge.js";

// ✅ FASE 1: Grabación manual IA (Editor)
import {
  startAICapture,
  stopAICapture,
  isAICapturing,
  getAICaptureInfo,
  recordAIMove,
  flushAICapture,
  stopAndFlushAICapture,
} from "./lib/ai.captureSession.js";


/* ============================================================================ */

// 🆕 Disparador global: otros módulos (o hooks de FX) pueden solicitar “emite tu estado”
if (typeof window !== "undefined") {
  window.__editorBroadcastState = window.__editorBroadcastState || (() => {});
}

setTimeout(() => window.applyEditorCleanup?.(), 0);

// no-op SFX fallbacks
sfx.move = sfx.move || (() => {});
sfx.capture = sfx.capture || (() => {});
sfx.promote = sfx.promote || (() => {});
sfx.invalid = sfx.invalid || (() => {});

const SHOW_DEBUG = false;
const USE_OV2 = false;

const FX_VIS_KEY = "ui.fxvis";
let FX_VIS_ON = (localStorage.getItem(FX_VIS_KEY) ?? "1") === "1";
function setFxVis(on){ FX_VIS_ON = !!on; try{ localStorage.setItem(FX_VIS_KEY, on ? "1" : "0"); }catch{} }

/* ---------- Botón de Sonido en el panel derecho (no flotante) ---------- */
function placeSfxToggleInRightPanel(container) {
  const killOrphanSfxButtons = () => {
    ["btn-sfx-toggle-float","sfx-float","sfxToggleFloat"].forEach((id)=>document.getElementById(id)?.remove());
    [...document.querySelectorAll("button,.btn,[role='button']")].forEach((el)=>{
      try{
        const t=(el.textContent||"").toLowerCase();
        const looks=/sonido\s*(on|off)|🔊|🔇/.test(t);
        const cs=getComputedStyle(el);
        if(looks&&(cs.position==="fixed"||el.id?.includes("sfx"))) el.remove();
      }catch{}
    });
  };
  killOrphanSfxButtons();

  const menuBtn = container.querySelector("#btn-menu");
  const parent = menuBtn?.parentElement || container.querySelector(".area-right") || container;
  if (!parent) return;

  let btn = container.querySelector("#btn-sfx-toggle");
  const getOn = () => !!(window.__sfxEnabled ?? true);
  const label = (on) => on ? "🔊 Sonido ON" : "🔇 Sonido OFF";
  const update = (on) => {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = label(on);
    btn.title = "Alt+S • alternar sonido";
    btn.classList.add("btn");
  };

  if (!btn) {
    btn = document.createElement("button");
    btn.id = "btn-sfx-toggle";
    btn.type = "button";
    btn.addEventListener("click", () => { try { window.__toggleSfx?.(); } catch {} update(getOn()); });
    (menuBtn && menuBtn.parentElement === parent)
      ? menuBtn.insertAdjacentElement("afterend", btn)
      : parent.appendChild(btn);
  }
  update(getOn());
  window.addEventListener("sfx:toggle", (e) => update(!!(e?.detail?.on ?? window.__sfxEnabled)));
}

/* ---------- FX helpers ---------- */
function flashCaptureBoard(boardEl){
  if(!FX_VIS_ON) return;
  try{
    const fx=boardEl?.querySelector(".fx-overlay"); if(!fx) return;
    fx.classList.remove("fx-capture"); fx.offsetWidth;
    fx.classList.add("fx-capture");
    setTimeout(()=>fx.classList.remove("fx-capture"),260);
  }catch{}
}
function pulseMoveBoard(boardEl){
  if(!FX_VIS_ON) return;
  try{
    const fx=boardEl?.querySelector(".fx-overlay"); if(!fx) return;
    fx.classList.remove("fx-move"); fx.offsetWidth;
    fx.classList.add("fx-move");
    setTimeout(()=>fx.classList.remove("fx-move"),180);
  }catch{}
}
function makeApplySingleCaptureWithSfx(fn, boardEl) {
  return (...a) => {
    const out = fn(...a);
    try { flashCaptureBoard(boardEl); } catch {}
    return out;
  };
}
function countPiecesSafe(b){
  let n=0;
  try{
    for(const row of (b||[])){
      if(!row) continue;
      for(const cell of row){
        if(cell==null) continue;
        try{ if(isGhost && isGhost(cell)) continue; }catch{};
        n++;
      }
    }
  }catch{};
  return n;
}
function makeSetBoardWithFX(boardEl, ref) {
  return (newBoard) => {
    const pc = countPiecesSafe(ref.current), nc = countPiecesSafe(newBoard);
    ref.current = newBoard;
    try {
      (Number.isFinite(pc)&&Number.isFinite(nc)&&nc<pc)
        ? flashCaptureBoard(boardEl)
        : pulseMoveBoard(boardEl);
    } catch {}
    // 🆕 Notificar “cambió el estado del editor” (el emisor real se define dentro de TrainingEditor)
    try { window.__editorBroadcastState?.(); } catch {}
  };
}

/* ---------- Glow remoto (aro de selección) ---------- */
function clearSelectedGlowRemote(boardEl){
  try {
    boardEl.querySelectorAll(".piece.glow-selected").forEach(el => {
      el.classList.remove("glow-selected");
      el.style.removeProperty("--ring-color");
    });
  } catch {}
}
function setSelectedGlowRemote(boardEl, r, c, pieceChar, colorOfFn, COLOR_CONSTS, boardCurrent){
  clearSelectedGlowRemote(boardEl);
  try {
    const tile  = boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    const piece = tile && tile.querySelector(".piece");
    if (!piece) return;

    // Determinar color real de la pieza en [r,c]; preferimos leer del tablero actual
    let cell = pieceChar;
    try {
      const cellFromBoard = (Array.isArray(boardCurrent) && boardCurrent[r]?.[c]) ? boardCurrent[r][c] : null;
      if (cellFromBoard) cell = cellFromBoard;
    } catch {}

    const col = (typeof colorOfFn === "function") ? colorOfFn(cell) : null;
    // Regla: ficha negra → aro blanco; ficha blanca → aro negro
    const ringColor = (col === COLOR_CONSTS?.NEGRO) ? "#FFFFFF" : "#000000";

    piece.classList.add("glow-selected");
    piece.style.setProperty("--ring-color", ringColor);
  } catch {}
}

/* ---------- WAN SFX bridge (anti-eco) ---------- */
let __applyingRemoteFx = false;

function wrapSfxForWAN(sfxObj, ws){
  const NAMES = ["move", "capture", "promote", "invalid"];
  const orig = {};
  for(const n of NAMES){
    orig[n] = typeof sfxObj[n] === "function" ? sfxObj[n].bind(sfxObj) : () => {};
  }

  for(const n of NAMES){
    sfxObj[n] = (...args) => {
      // 1) sonar local SIEMPRE
      try { orig[n](...args); } catch {}
      // 2) si viene de remoto, no re-emitir (anti-eco)
      if (__applyingRemoteFx) return;
      // 3) si no hay WS o no está OPEN -> salir
      try {
        const connected = (typeof ws?.isConnected === "function"
          ? ws.isConnected()
          : !!ws?.isOpen?.());
        if (!connected) return;
        ws.safeSend?.({ v:1, t:"uifx", op:"sfx", payload:{ name:n } });
      } catch {}
    };
  }
}

function playRemoteSfx(name, sfxObj){
  const fn = typeof sfxObj?.[name] === "function"
    ? sfxObj[name].bind(sfxObj)
    : null;
  if (!fn) return;
  const prev = __applyingRemoteFx;
  __applyingRemoteFx = true;
  try { fn(); } catch {}
  __applyingRemoteFx = prev;
}

/* ---------- FEN ---------- */
async function downloadFen({ board, turn }) {
  const result = { ok:false, filename:null, reason:null };
  try{
    const mod=await import("./services/fen.js");
    const enc=mod.toFEN||mod.boardToFEN||mod.encodeFEN||mod.exportFEN||mod.default;
    if(typeof enc!=="function") throw new Error("No exportador FEN");
    const fen=enc(board,turn); if(!fen||typeof fen!=="string") throw new Error("FEN inválido");
    const ts=new Date().toISOString().replace(/[:.]/g,"-");
    const filename=`pos_${ts}.fen`;
    const blob=new Blob([fen],{type:"text/plain;charset=utf-8"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    result.ok=true;
    result.filename=filename;
    return result;
  }catch(e){
    console.error("[FEN] principal]:",e);
    try{
      const ts=new Date().toISOString().replace(/[:.]/g,"-");
      const filename=`pos_${ts}.fen`;
      const snap={board,turn};
      const blob=new Blob([JSON.stringify(snap)],{type:"application/json"});
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      result.ok=true;
      result.filename=filename;
      result.reason="fallback";
      return result;
    }catch(ee){
      console.error("[FEN] fallback]:",ee);
      result.ok=false;
      result.reason="fatal";
      return result;
    }
  }
}

async function copyFenToClipboard({ board, turn }) {
  try{
    const mod=await import("./services/fen.js");
    const enc=mod.toFEN||mod.boardToFEN||mod.encodeFEN||mod.exportFEN||mod.default;
    if(typeof enc!=="function") throw new Error("No exportador FEN");
    const fen=enc(board,turn); if(!fen||typeof fen!=="string") throw new Error("FEN inválido");

    const isLocalhost = /^localhost$|\.local$|^127\.0\.0\.1$/.test(location.hostname);
    if (navigator.clipboard && (window.isSecureContext || isLocalhost)) {
      await navigator.clipboard.writeText(fen);
      return { ok:true, fen, method:"clipboard" };
    }
    // Fallback: execCommand dentro del gesto de usuario
    const ta=document.createElement("textarea");
    ta.value=fen;
    ta.setAttribute("readonly","");
    ta.style.position="fixed";
    ta.style.left="-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok=document.execCommand("copy");
    ta.remove();
    if(!ok) throw new Error("execCommand(copy) falló");
    return { ok:true, fen, method:"execCommand" };
  }catch(e){
    console.error("[FEN] copiar]:",e);
    return { ok:false, error:String(e?.message||e) };
  }
}

/* ---- Forzar repintado si el layout tarda y el board queda “vacío” ---- */
function ensureBoardVisible(container, board) {
  try {
    const boardEl = container.querySelector("#board");
    if (!boardEl) return;
    boardEl.style.visibility = "visible";
    boardEl.style.opacity = "1";
    boardEl.style.removeProperty("display");
    const hasGfx = boardEl.querySelector("canvas,svg");
    if (!hasGfx) {
      try { drawBoard(boardEl, board, SIZE, dark); }
      catch { try { drawBoard(boardEl, board, dark); } catch {} }
    }
  } catch {}
}

/* =======================================================================
   ✅ KEY canónica (idéntica a ai_engine.py board_to_key)
   - '.' para vacío
   - 10 filas separadas por '/'
   - incluye side al final
   Ej: "....n...../..r......./...|side:N"
   ======================================================================= */
function boardToKeyCanonical(board10, side){
  try{
    const s = String(side || "R").toUpperCase() === "N" ? "N" : "R";
    if (!Array.isArray(board10) || board10.length !== 10) return null;

    const rows = [];
    for(let r=0;r<10;r++){
      const row = board10[r];
      if (!Array.isArray(row) || row.length !== 10) return null;
      let out = "";
      for(let c=0;c<10;c++){
        const ch = row[c];
        out += (ch === "r" || ch === "n" || ch === "R" || ch === "N") ? ch : ".";
      }
      rows.push(out);
    }
    return rows.join("/") + `|side:${s}`;
  }catch{
    return null;
  }
}

/* ---- Debug opcional: comparar key con backend (/ai/debug-key) ---- */
async function debugKeyOnBackend(board10, side){
  try{
    const url =
      (window.__IA_BACKEND_URL) ||
      (import.meta?.env?.VITE_IA_BACKEND_URL) ||
      (import.meta?.env?.VITE_BACKEND_URL) ||
      "http://127.0.0.1:8001";
    const r = await fetch(String(url).replace(/\/$/,"") + "/ai/debug-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: board10, side }),
    });
    const data = await r.json().catch(()=>null);
    if (!r.ok) {
      console.warn("[AI-DEBUG-KEY] backend non-ok", r.status, data);
      return null;
    }
    return data;
  }catch(e){
    // silencioso: no queremos romper Editor si backend no está
    console.warn("[AI-DEBUG-KEY] no disponible:", e?.message || e);
    return null;
  }
}

/* ---------- Helpers IA (Editor) ---------- */
function parseAlgebraToCoords(moveStr) {
  // Soporta: "e3-f4" o "c3-e5-g7"
  // Convención típica: columnas a-j => 0-9, filas 1-10
  // Nota: si tu algebra usa otra convención, aquí es el único punto a ajustar.
  const s = String(moveStr || "").trim();
  if (!s) return null;
  const parts = s.split("-").map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const out = [];
  for (const p of parts) {
    const m = p.match(/^([a-jA-J])(\d{1,2})$/);
    if (!m) return null;
    const file = m[1].toLowerCase().charCodeAt(0) - 97; // a=0
    const rank = parseInt(m[2], 10); // 1..10
    if (!(file >= 0 && file < 10)) return null;
    if (!(rank >= 1 && rank <= 10)) return null;

    // Importante: muchos tableros usan fila 10 arriba (r=0) y 1 abajo (r=9)
    // Ajuste: r = 10 - rank
    const r = 10 - rank;
    const c = file;
    out.push([r, c]);
  }
  return out;
}

function applyMoveCompat(board, coords) {
  // Intenta varias firmas comunes sin romper
  // Devuelve { ok, board: newBoard?, error? }
  try {
    // 1) aplicarMovimiento(board, coordsArray)
    try {
      const nb = aplicarMovimiento(board, coords);
      if (Array.isArray(nb)) return { ok: true, board: nb, mode: "aplicarMovimiento(board, coords)" };
    } catch {}

    // 2) aplicarMovimiento(board, from, to)
    try {
      const nb = aplicarMovimiento(board, coords[0], coords[coords.length - 1]);
      if (Array.isArray(nb)) return { ok: true, board: nb, mode: "aplicarMovimiento(board, from, to)" };
    } catch {}

    // 3) aplicarMovimiento(board, from, to, coords)
    try {
      const nb = aplicarMovimiento(board, coords[0], coords[coords.length - 1], coords);
      if (Array.isArray(nb)) return { ok: true, board: nb, mode: "aplicarMovimiento(board, from, to, coords)" };
    } catch {}

    return { ok: false, error: "No pude aplicar la jugada con las firmas conocidas de aplicarMovimiento()." };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ---------- Editor ---------- */
export default function TrainingEditor(container) {
  try { container?.setAttribute("data-editor-root", "1"); } catch {}

  let board = startBoard();
  let turn = COLOR.ROJO;
  let placing = null;
  let stepState = null;

  // 🧩 Exponer API mínima para que el halo de turno lea el turno real del Editor
  try {
    const g = (window.__D10 = window.__D10 || {});
    g.get = () => ({
      // El halo interpreta "ROJO"/"R"/"WHITE"/"W" como BLANCAS
      // y "NEGRO"/"N"/"BLACK"/"B" como NEGRAS.
      turn: (turn === COLOR.ROJO ? "ROJO" : "NEGRO"),
    });
  } catch {}

  // 🔁 Emisión automática con debounce + guardia anti-eco
  let applyingRemote = false;   // evita re-emitir lo que viene por WS
  let lastBroadcast = 0;
  let broadcastTimer = 0;

  // Se definirá más tarde una vez tengamos _ws y boardRef
  let _ws = null;
  let doPushStateNow = () => {};

  function broadcastSoon(reason = "edit", delay = 140) {
    if (typeof doPushStateNow !== "function") return false;
    const now = Date.now();
    if (now - lastBroadcast < delay) {
      clearTimeout(broadcastTimer);
      broadcastTimer = setTimeout(() => {
        lastBroadcast = Date.now();
        doPushStateNow();
      }, delay);
      return true;
    }
    lastBroadcast = now;
    doPushStateNow();
    return true;
  }

  // helpers para centralizar cambios + emisión
  const setBoardLocal = (b, reason = "board-change") => {
    setBoardFX(b);
    board = boardRef.current;
    broadcastSoon(reason);
  };
  const setTurnLocal = (t, reason = "turn-change") => {
    turn = t;
    broadcastSoon(reason);
  };

  const setTurnTextUI = () => updateTurnUI(container, turn);
  const boardForSave = () => boardForSaveRaw(board, stepState, { finalizeDeferred, isGhost });

  container.innerHTML = getEditorTemplate(turn);

  // 🔒 Delegado robusto para 'Volver al menú' (SPA + fallback <a href="/">)
  try {
    const stId = "css-btn-menu-raise";
    if (!document.getElementById(stId)) {
      const st = document.createElement("style");
      st.id = stId;
      st.textContent = `#btn-menu{position:relative;z-index:100000;pointer-events:auto}`;
      document.head.appendChild(st);
    }
    container.addEventListener("click", (ev) => {
      const el = ev.target && (ev.target.closest ? ev.target.closest("#btn-menu") : null);
      if (!el) return;
      try {
        if (typeof navigate === "function") { navigate("/"); }
        else if ("hash" in location) { location.hash = "#/"; }
      } catch {}
    }, { capture: true });
  } catch {}

  // SFX (sin botones; sólo lógica)
  try { initEditorSFX(container); } catch {}

  // 🆕 Asegurar CSS/infra FX globales (zoom/pulse) activas
  try { ensureGlobalFX(); } catch {}

  // Quitar selector de Variante si el template lo trae
  try {
    const sel = container.querySelector("#variantSelect");
    if (sel) {
      container.querySelector("label[for='variantSelect']")?.remove();
      sel.remove();
    }
  } catch {}

  installVariantHints(container);
  installVariantBreadcrumbs(container);
  syncVariantToolTitles(container);

  applyButtonIcons(container);
  try {
    container.querySelector("#btn-inicial")?.setAttribute("data-test-id","btn-inicial");
    container.querySelector("#btn-cambiar-turno")?.setAttribute("data-test-id","btn-cambiar-turno");
    container.querySelector("#btn-download-fen")?.setAttribute("data-test-id","btn-download-fen");
    container.querySelector("#btn-copy-fen")?.setAttribute("data-test-id","btn-copy-fen");
    container.querySelector("#btn-menu")?.setAttribute("data-test-id","btn-menu");
    container.querySelector("#btn-goldens-ui")?.setAttribute("data-test-id","btn-goldens-ui");
  } catch {}

  initEditorChrome(container);
  installAssetFallbacks(container);
  setupResponsive(container);
  applyEditorLayout(container);

  const boardEl = container.querySelector("#board");
  const dbgEl   = SHOW_DEBUG ? container.querySelector("#dbg") : null;

  let fxOverlay = boardEl?.querySelector(".fx-overlay");
  if (!fxOverlay && boardEl) {
    fxOverlay = document.createElement("div");
    fxOverlay.className = "fx-overlay";
    boardEl.appendChild(fxOverlay);
  }

  const boardRef = { current: board };
  const setBoardFX = makeSetBoardWithFX(boardEl, boardRef);

  // ==========================
  // 🧠 Learning bridge (Editor -> logMoves.js)
  // ==========================
  function emitLearningMoveFromEditor({ move, score = 0, tag = "editor", k = null } = {}) {
    try {
      // lado en formato "R"/"N"
      const side = (turn === COLOR.ROJO) ? "R" : "N";

      // ✅ tablero 10x10 REAL: lo mandamos como JSON string
      const board10 = boardRef.current;
      const fen = JSON.stringify(board10);

      if (!move) return false;

      window.dispatchEvent(new CustomEvent("learning:push-move", {
        detail: {
          ts: Date.now(),
          fen,          // legacy (string JSON del board 10x10)
          k: k || null, // ✅ NUEVO: key canónica (si está)
          side,         // "R" o "N"
          move: String(move),
          score: Number(score) || 0,
          tag,
        }
      }));

      return true;
    } catch (e) {
      return false;
    }
  }

  function setChainFlag(flag){
    if(!boardEl) return;
    flag ? boardEl.setAttribute("data-chain","1") : boardEl.removeAttribute("data-chain");
  }

  const applySnapshot = (snap) => {
    if (!snap || !Array.isArray(snap.board)) return;
    saveLocalAutoFrom(snap.board, snap.turn);
    board = snap.board; turn = snap.turn;
    try { drawBoard(boardEl, board, SIZE, dark); }
    catch { try { drawBoard(boardEl, board, dark); } catch {} }
    try { typeof clearHints === "function" && clearHints(boardEl); } catch {}
    try { updateTurnUI(container, turn); } catch {}
    try { boardEl?.removeAttribute("data-locked"); } catch {}
    try { boardEl?.removeAttribute("data-chain"); } catch {}
    try { clearSelectedGlowRemote(boardEl); } catch {}
    stepState = null;
    setChainFlag(false);
    placing = null;
    try { syncToolButtons?.(container, placing); } catch {}
    try {
      queueMicrotask(() => {
        const prev = turn;
        const other = (prev === COLOR.ROJO ? COLOR.NEGRO : COLOR.ROJO);
        if (typeof switchTurnUI === "function") {
          switchTurnUI();
          queueMicrotask(() => {
            switchTurnUI();
            try { render(); } catch {}
            try { paintState(); } catch {}
          });
        } else {
          turn = other;
          updateTurnUI(container, turn);
          queueMicrotask(() => {
            turn = prev;
            updateTurnUI(container, turn);
            try { render(); } catch {}
            try { paintState(); } catch {}
          });
        }
      });
    } catch {}
    try { drawBoard(boardEl, board, SIZE, dark); }
    catch { try { drawBoard(boardEl, board, dark); } catch {} }
    try { updateTurnUI(container, turn); } catch {}
    queueMicrotask(() => {
      try { typeof repaintOverlays === "function" && repaintOverlays(); } catch {}
      try { typeof render === "function" && render(); } catch {}
      try { typeof paintState === "function" && paintState(); } catch {}
    });

    // 🆕 Emitir snapshot por WS cuando aplicamos posición manualmente
    try { window.__editorBroadcastState?.(); } catch {}
  };

  installPositionsPanel(container, {
    applySnapshot,
    boardForSave,
    getTurn: () => turn,
    getSize: () => SIZE,
  });
  try { container.querySelector("#btn-pruebas-dev")?.remove(); } catch {}

  const verifyBtn = container.querySelector("#btn-verificar");
  const clearOV2Layer = () => {
    const layer = boardEl?.querySelector(".ov2-layer");
    if (layer) layer.innerHTML = "";
  };
  const syncVerifyLabel = () => {
    try { if (verifyBtn) verifyBtn.textContent = "Ver capturas"; } catch {}
  };
  syncVerifyLabel();

  const repaintOverlays = (() => {
    let rafId = 0;
    return () => {
      const layer = document.querySelector("#board .ov2-layer");
      if (!layer) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => { rafId = 0; });
    };
  })();

  try {
    if (boardEl.__ov2RO) { try { boardEl.__ov2RO.disconnect(); } catch {} }
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        repaintOverlays();
      });
    });
    ro.observe(boardEl);
    boardEl.__ov2RO = ro;
  } catch {}

  const render = () => {
    if (!boardEl) return;
    drawBoard(boardEl, board, SIZE, dark);
    setEditingFlag(boardEl, placing);
    repaintOverlays();
  };

  function paintState() {
    paintView({
      boardEl, board, turn,
      setTurn: (t) => { turn = t; },
      stepState,
      setStepState: (ss) => { stepState = ss; setChainFlag(!!ss); repaintOverlays(); },
      container, dbgEl, showDebug: SHOW_DEBUG
    });
    setTurnTextUI();
    repaintOverlays();
  }

  // 🔁 Reajustar layout y tablero al cambiar tamaño/zoom de ventana
  const handleResize = (() => {
    let rafId = 0;
    return () => {
      if (!boardEl) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;

        try {
          const w = window.innerWidth || document.documentElement.clientWidth || 0;
          if (w >= 1200) {
            const row =
              document.querySelector("#board-row") ||
              document.querySelector(".board-row") ||
              document.querySelector(".editor-layout");

            if (row) {
              row.__topControlsApplied = false;
              row.style.removeProperty("display");
              row.style.removeProperty("flex-direction");
              row.style.removeProperty("align-items");
              row.style.removeProperty("justify-content");
              row.style.removeProperty("gap");
              row.style.removeProperty("padding");
            }

            document
              .querySelectorAll(".top-controls-grid[data-made-by='ipad-fix']")
              .forEach(grid => {
                const parent = grid.parentElement;
                if (!parent) return;
                while (grid.firstChild) {
                  parent.insertBefore(grid.firstChild, grid);
                }
                grid.remove();
              });
          }
        } catch {}

        try { applyEditorLayout(container); } catch {}
        try { ensureBoardVisible(container, board); } catch {}
        try { render(); } catch {}
        try { paintState(); } catch {}
        try { syncToolButtons(container, placing); } catch {}
      });
    };
  })();

  if (typeof window !== "undefined") {
    window.addEventListener("resize", () => {
      handleResize();
    });
  }

  const undo = setupUndo(container, {
    getBoard: () => board, setBoard: (b) => setBoardLocal(b, "undo"),
    getTurn:  () => turn,  setTurn:  (t) => setTurnLocal(t, "undo"),
    render,
    paintState,
    afterApply: () => {
      stepState = null;
      setChainFlag(false);
      setTurnTextUI();
    },
  });
  const saveForUndo  = () => undo.save();

  const { controller: HINTS_FOR_CONTROLLER, interactions: HINTS_FOR_INTERACTIONS } = buildHints({
    useOV2: USE_OV2,
    clearHints,
    clearVerification,
    markRouteLabel: undefined,
    markStep: undefined,
    showFirstStepOptions,
    hintMove,
  });

  const { switchTurn, continueOrEndChain } = makeController({
    container,
    getBoard: () => board,
    setBoard: (b) => setBoardLocal(b, "controller"),
    getTurn:  () => turn,
    setTurn:  (t) => setTurnLocal(t, "controller"),
    getStepState: () => stepState,
    setStepState: (s) => { stepState = s; setChainFlag(!!s); repaintOverlays(); },
    render,
    paintState,
    deps: { movimientos },
    hints: HINTS_FOR_CONTROLLER,
  });

  const switchTurnUI = () => {
    try { clearSelectedGlowRemote(boardEl); } catch {}
    switchTurn();
    setTurnTextUI();
  };

  function setPlacing(mode) {
    placing = (placing === mode) ? null : mode;
    setEditingFlag(boardEl, placing);
    syncToolButtons(container, placing);
    repaintOverlays();
  }

  container.querySelector("#btn-cambiar-turno")?.addEventListener("click", () => {
    setPlacing(null);
    stepState = null;
    setChainFlag(false);
    switchTurnUI();
    render();
    paintState();
    broadcastSoon("switch-turn");
  });

  container.querySelector("#btn-download-fen")?.addEventListener("click", async () => {
    const res = await downloadFen({ board, turn });
    toast(
      res?.ok
        ? (res.reason === "fallback"
            ? "Descargado (.fen con snapshot JSON)"
            : "Descargado (.fen)")
        : "No se pudo exportar la posición. Revisa la consola.",
      res?.ok ? 2600 : 2800
    );
  });

  // 🚀 Copiar FEN → enviar snapshot + FEN crudo
  container.querySelector("#btn-copy-fen")?.addEventListener("click", async () => {
    const res = await copyFenToClipboard({ board, turn });
    broadcastSoon("copy-fen", 60);
    toast(
      res?.ok
        ? "FEN copiado y enviado a la sala"
        : "Enviado a la sala (copia local no disponible)",
      2200
    );
  });

  render();
  undo.updateUI();
  paintState();
  setTurnTextUI();

  ensureBoardVisible(container, board);
  requestAnimationFrame(() => ensureBoardVisible(container, board));
  setTimeout(() => ensureBoardVisible(container, board), 0);

  bindBoardInteractions(container, {
    SIZE,
    getBoard: () => board,
    setBoard: (b) => setBoardLocal(b, "move"),
    getTurn:  () => turn,
    setTurn:  (t) => setTurnLocal(t, "move"),
    getStepState: () => stepState,
    setStepState: (s) => { stepState = s; setChainFlag(!!s); repaintOverlays(); },
    getPlacing: () => placing,
    render,
    paintState,
    saveForUndo,
    rules: { colorOf, mejoresCapturasGlobal, movimientos, aplicarMovimiento },
    editorMoves: { applySingleCapture: makeApplySingleCaptureWithSfx(applySingleCapture, boardEl) },
    hints: HINTS_FOR_INTERACTIONS,
    controller: {
      continueOrEndChain,
      switchTurn: () => {
        try { clearSelectedGlowRemote(boardEl); } catch {}
        switchTurn();
        setTurnTextUI();
        broadcastSoon("switch-turn");
      }
    },
  });

  // Ocultar "Ver capturas" (solo texto accesible)
  (function hideVerifyBtn(){
    const verifyBtn = container.querySelector("#btn-verificar");
    if (!verifyBtn) return;
    verifyBtn.style.display = "none";
    try { verifyBtn.textContent = "Ver capturas"; } catch {}
  })();

  setupToolbar(container, {
    SIZE,
    undo,
    getBoard: () => board,
    setBoard: (b) => setBoardLocal(b, "toolbar"),
    startBoard,
    setPlacing: (m) => setPlacing(m),
    getPlacing: () => placing,
    setStepState: (s) => { stepState = s; setChainFlag(!!s); },
    render,
    paintState,
    share: () => sharePosition(container, { turn, board: boardForSave() }),
  });
  syncToolButtons(container, placing);

  // 👉 Botón de Sonido junto a los botones de la derecha
  placeSfxToggleInRightPanel(container);

  // ==========================
  // ✅ FASE 1: PANEL IA (Editor)
  // ==========================
  (function mountAICapturePanel(){
    const tools = document.getElementById("tools") || container.querySelector("#tools");
    if (!tools) return;

    // CSS mínimo inline (evita tocar otros .css)
    try {
      const id = "ai-capture-panel-css";
      if (!document.getElementById(id)) {
        const st = document.createElement("style");
        st.id = id;
        st.textContent = `
          .ai-capture-box{margin-top:8px;display:flex;flex-direction:column;gap:6px}
          .ai-capture-row{display:flex;gap:6px;flex-wrap:wrap}
          .ai-capture-state{font-size:12px;opacity:.9}
          .ai-hide{display:none!important}
        `;
        document.head.appendChild(st);
      }
    } catch {}

    // Evitar duplicados si re-montas vista
    tools.querySelector(".ai-capture-box")?.remove();

    const box = document.createElement("div");
    box.className = "ai-capture-box";
    box.innerHTML = `
      <div class="ai-capture-row">
        <button class="btn" id="btn-ai-toggle" type="button">▶️ Empezar grabación IA</button>
        <button class="btn" id="btn-ai-play" type="button">🤖 Jugar por la IA</button>
      </div>
      <div class="ai-capture-state" id="ai-rec-state"></div>
    `;
    tools.appendChild(box);

    const stateEl = box.querySelector("#ai-rec-state");
    const btnToggle = box.querySelector("#btn-ai-toggle");
    const btnPlay   = box.querySelector("#btn-ai-play");

    const refresh = () => {
      const info = getAICaptureInfo();
      const rec = !!info.recording;

      // ✅ Siempre visible; solo se habilita cuando estás grabando
      btnPlay.disabled = !rec;
      btnToggle.textContent = rec
        ? "⏹️ Detener grabación IA"
        : "▶️ Empezar grabación IA";

      stateEl.textContent = rec
        ? `IA: GRABANDO • buffer: ${info.buffered}`
        : `IA: OFF`;
    };

    async function stopAndFlush() {
      try {
        const before = getAICaptureInfo();
        stopAICapture();

        const resp = await flushAICapture({ clearOnOk: true });

        if (resp.ok) {
          toast(`IA: ${resp.sent || before.buffered || 0} jugadas guardadas ✅`, 2000);
        } else {
          toast(`IA: no se pudo guardar ❌ (${resp.status})`, 2600);
          console.warn("[AI-CAPTURE] flush fail:", resp);
        }

        refresh();
      } catch (e) {
        console.warn("[AI-CAPTURE] stopAndFlush error:", e);
        toast("IA: error al guardar ❌", 2600);
      }
    }

    btnToggle.onclick = async () => {
      const info = getAICaptureInfo();
      if (!info.recording) {
        startAICapture();
        toast("IA: grabación iniciada", 1600);
        refresh();
        return;
      }
      await stopAndFlush();
    };

    async function playAIMove() {
      try {
        // ✅ IMPORTANTE: para que "aprendizaje por experiencia" coincida,
        // mandamos SIEMPRE el tablero 10x10 (boardSnapshot) a pedirJugadaIA().
        const boardSnap = boardRef.current;
        const sideBefore = (turn === COLOR.ROJO) ? "R" : "N";

        // ✅ KEY canónica local (misma que Python)
        const k = boardToKeyCanonical(boardSnap, sideBefore);

        // ✅ Debug opcional (si /ai/debug-key existe)
        // (No rompe si no existe; solo log)
        debugKeyOnBackend(boardSnap, sideBefore).then((dbg)=>{
          if (dbg?.ok && dbg?.k && k && dbg.k !== k) {
            console.warn("[AI-KEY MISMATCH] local != backend", { local: k, backend: dbg.k });
          }
        }).catch(()=>{});

        const data = await pedirJugadaIA("", sideBefore, boardSnap);
        const moveStr = data?.move || data?.jugada || data?.bestMove || null;
        if (!moveStr) { toast("IA: no hay jugada", 2000); return; }

        const coords = parseAlgebraToCoords(moveStr);
        if (!coords) {
          toast("IA: formato de jugada no reconocido", 2400);
          console.warn("[IA] move recibido:", moveStr);
          return;
        }

        const applied = applyMoveCompat(board, coords);
        if (!applied.ok || !applied.board) {
          toast("IA: no pude aplicar esa jugada (ver consola)", 2600);
          console.warn("[IA] applyMoveCompat fallo:", applied, { moveStr, coords });
          return;
        }

        try { undo.save(); } catch {}
        setBoardLocal(applied.board, "ai-play");
        render();
        paintState();

   // ❌ NO grabar IA en el dataset humano
// if (isAICapturing()) { ... }

        // ✅ además: empujar al sistema de aprendizaje (logMoves.js) con tablero 10x10 + k
        emitLearningMoveFromEditor({
          move: moveStr,
          score: 0,
          tag: "editor_ai_play_learning",
          k: k || null,
        });

        refresh();
        toast("IA: jugada aplicada", 1400);
      } catch (e) {
        console.warn("[IA] playAIMove error:", e);
        toast("IA: error ejecutando jugada", 2000);
      }
    }

    btnPlay.onclick = () => playAIMove();
    refresh();
  })();

  // Patch visual: panel izquierdo y tarjeta "Turno" transparentes
  (() => {
    try {
      const st = document.createElement("style");
      st.id = "editor-transparent-panels";
      st.textContent = `
        [data-editor-root]{--panel-bg:transparent!important;--card-bg:transparent!important}
        [data-editor-root] .card.editor-card,
        [data-editor-root] .area-left,
        [data-editor-root] .area-left>.card,
        [data-editor-root] .area-left .card,
        [data-editor-root] .area-left .panel,
        [data-editor-root] .dock-turno .turn-card{
          background:transparent!important;box-shadow:none!important;border:none!important;backdrop-filter:none!important
        }
        [data-editor-root] .area-left .btn,
        [data-editor-root] .area-left button,
        [data-editor-root] .area-left a[role="button"]{background:transparent!important}
      `;
      document.head.appendChild(st);
    } catch (e) { console.warn("[transparent-panels patch]", e); }
  })();

  // Botón "Girar tablero" (solo local, debajo de botones de edición)
  try { mountRotateBoardButton(document.getElementById("tools")); } catch {}

  container.querySelector("#btn-inicial")?.addEventListener("click", () => {
    undo.save();
    board = startBoard(); turn = COLOR.ROJO;
    setPlacing(null);
    stepState = null;
    setChainFlag(false);
    try { clearSelectedGlowRemote(boardEl); } catch {}
    render();
    paintState();
    setTurnTextUI();
    broadcastSoon("reset");
  });

  container.querySelector("#btn-menu")?.addEventListener("click", () => {
    setPlacing(null);
    if (typeof navigate === "function") navigate("/");
    else location.hash = "#/";
  });

  /* =======================
     🧠 UI Remota por WS (t:"ui" / t:"uifx")
     ======================= */
  const onRemoteUI = (msg) => {
    try {
      if (!msg) return;

      // 1) Sonidos/FX remotos
      if (msg.t === "uifx") {
        const { op, payload } = msg;
        if (op === "sfx" && payload && payload.name) {
          playRemoteSfx(String(payload.name), sfx);
        }
        return;
      }

      // 2) Selección remota (zoom/aro)
      if (msg.t === "ui") {
        const { op, payload } = msg;
        if (op === "select" && payload) {
          const { r, c, color: pieceChar } = payload;
          if (boardEl && Number.isFinite(r) && Number.isFinite(c)) {
            try { triggerPieceZoom(boardEl, [r, c], { duration: 220 }); } catch {}
            try { setSelectedGlowRemote(boardEl, r, c, pieceChar, colorOf, COLOR, board); } catch {}
            try { sfx?.move?.(); } catch {}
          }
        }
        return;
      }
    } catch {}
  };

  // 🆕 Montaje del puente WS (después de tener render/paintState disponibles)
  const editorApi = {
    getBoard: () => board,
    getTurn:  () => turn,
    // ⚠️ setters con guardia anti-eco (aplicación remota)
    setBoard: (b) => {
      applyingRemote = true;
      try { setBoardFX(b); board = boardRef.current; }
      finally { applyingRemote = false; }
    },
    setTurn:  (t) => {
      applyingRemote = true;
      try { turn = t; }
      finally { applyingRemote = false; }
    },
    repaint: () => {
      try { render(); } catch {}
      try { paintState(); } catch {}
    },
    rebuildHints: () => {
      try { buildHints(); } catch {}
    },
    // ➕ efectos remotos
    onRemoteUI,
  };

  _ws = createEditorWSBridge(editorApi);
  _ws.onStatus((s) => {
    // console.log("[Editor WS]", s);
  });

  // Envolver SFX para que viajen por WS
  try { wrapSfxForWAN(sfx, _ws); } catch {}

  // 🆕 Definir el emisor real de estado (usa la sala y clientId del bridge)
  doPushStateNow = () => {
    try {
      if (applyingRemote) return; // anti-eco
      const connected = (typeof _ws?.isConnected === "function"
        ? _ws.isConnected()
        : !!_ws?.isOpen?.());
      if (!connected) return; // requiere socket abierto
      const snap = { board: boardRef.current, turn };
      _ws.safeSend?.({ v: 1, t: "state", payload: snap });
    } catch {}
  };

  // 🆕 El bus global dispara la emisión con un debounce corto
  if (typeof window !== "undefined") {
    window.__editorBroadcastState = () => broadcastSoon("fx-hook", 120);
  }

  // Reenvía eventos de UI (selección) hacia la otra punta
  window.addEventListener("editor:ui", (ev) => {
    try {
      const d = ev?.detail || {};
      _ws?.safeSend?.({
        v: 1,
        t: "ui",
        op: String(d.op || "select"),
        payload: { r: d.r, c: d.c, color: d.color ?? null }
      });
    } catch {}
  });

  // Panel WAN (debajo de los botones de edición)
  installEditorWANPanel(container, { getBridge: () => _ws });

  // Aplicar FEN recibido (t:"fen") — manejado por el listener de eventos
  window.addEventListener("wan:fen", async (e) => {
    const fenStr = e?.detail?.fen;
    if (!fenStr) return;
    try {
      const mod = await import("./services/fen.js");
      const dec = mod.fromFEN || mod.parseFEN || mod.importFEN || mod.decodeFEN || mod.toBoardFromFEN;
      if (typeof dec !== "function") throw new Error("No hay decodificador FEN");
      const out = dec(fenStr);
      const b = out?.board || out?.b || out?.position || out;
      const t = typeof out?.turn !== "undefined" ? out.turn : turn;
      if (Array.isArray(b)) {
        applySnapshot({ board: b, turn: t });
        console.log("[Editor] FEN remoto aplicado ✓");
      } else {
        console.warn("[Editor] FEN remoto inválido");
      }
    } catch (err) {
      console.warn("[Editor] Error al aplicar FEN remoto:", err);
    }
  });

  undo.updateUI();
}

// 🔔 Sonido de jugada inválida
window.addEventListener("rules:invalid-move", () => {
  try { sfx.invalid?.(); } catch {}
});

queueMicrotask(() => {
  try { installReplayDevHook(); }
  catch (e) { console.warn("[replay] no inició:", e); }
});

if (typeof window !== "undefined") {
  window.__DAMAS_setVariant = function(name) {
    try {
      setRulesVariant(name);
      const pol = getPolicy?.() || {};
      console.log("[VARIANT]", name, pol);
      window.dispatchEvent(new CustomEvent("rules:variant-changed", { detail: { variant: name } }));
    } catch (e) { console.error("[VARIANT] Error:", e); }
  };
  window.__DAMAS_getPolicy = function() {
    try {
      const pol = getPolicy?.() || {};
      console.log("[POLICY]", pol);
      return pol;
    } catch (e) {
      console.error("[POLICY] Error:", e);
      return null;
    }
  };
}

// ⛳ Botón GOLDEN tras montar
(function mountGoldenButtonSoon(){
  const go = () => {
    try { installGoldenButton(document); }
    catch (e) { console.warn("[GOLDEN] no se pudo montar:", e); }
  };
  if (document.readyState === "complete" || document.readyState === "interactive")
    setTimeout(go, 0);
  else
    window.addEventListener("DOMContentLoaded", go, { once: true });
})();

/* === A11Y: Alto Contraste (Alt+H) y roving focus === */
(function a11yHighContrastToggle(){
  const KEY = "ui.hc";
  const applyHC = (on) => {
    if (on) document.documentElement.setAttribute("data-hc", "1");
    else document.documentElement.removeAttribute("data-hc");
  };
  const isTypingTarget = (t) => {
    const tag = (t?.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || !!t?.isContentEditable;
  };
  applyHC(localStorage.getItem(KEY) === "1");
  window.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target)) return;
    const key  = String(e.key || "").toLowerCase();
    const code = String(e.code || "");
    const isH = (key === "h") || (code === "KeyH");
    if (isH && e.altKey) {
      const next = localStorage.getItem(KEY) === "1" ? "0" : "1";
      localStorage.setItem(KEY, next);
      applyHC(next === "1");
      try {
        (window.toast || ((m)=>console.log("[A11Y]", m)))(
          next === "1" ? "Alto contraste: ON" : "Alto contraste: OFF"
        );
      } catch {}
      e.preventDefault();
    }
  }, { passive: false });
})();

(function a11yToolbarRovingFocus(){
  const tb = document.querySelector("#editor-toolbar") || document.querySelector(".editor-toolbar");
  if (!tb) return;
  const items = Array.from(tb.querySelectorAll('button, a[role="button"]')).filter(Boolean);
  if (items.length === 0) return;
  items.forEach(el => {
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
  });
  tb.addEventListener("keydown", (e) => {
    const k = e.key;
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(k)) return;
    const itemsArr = items;
    const active = document.activeElement;
    const idx = itemsArr.indexOf(active);
    let ni = Math.max(0, idx);
    if (k === "ArrowRight") ni = (idx + 1) % itemsArr.length;
    if (k === "ArrowLeft")  ni = (idx - 1 + itemsArr.length) % itemsArr.length;
    if (k === "Home")       ni = 0;
    if (k === "End")        ni = itemsArr.length - 1;
    itemsArr[ni]?.focus();
    e.preventDefault();
  });
})();
