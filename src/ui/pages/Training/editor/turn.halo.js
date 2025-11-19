// src/ui/pages/Training/editor/turn.halo.js
// Halo SOLO en piezas del color en turno (robusto para el Editor).
//
// ──────────────────────────────────────────────────────────────
// PASOS QUE HAY QUE HACER PARA QUE EL EFECTO CAMBIE DE TURNO:
// ──────────────────────────────────────────────────────────────
//
// 1) En el archivo:
//      src/ui/pages/Training/editor/Editor.js
//    busca dentro de la función principal:
//
//      export default function TrainingEditor(container) {
//        ...
//        let board = startBoard();
//        let turn = COLOR.ROJO;
//        let placing = null;
//        let stepState = null;
//        ...
//      }
//
// 2) Justo DEBAJO de esas líneas (debajo de let turn / let placing / let stepState),
//    pega este bloque:
//
//      try {
//        const g = (window.__D10 = window.__D10 || {});
//        g.get = () => ({
//          // El halo interpreta "ROJO"/"R"/"WHITE"/"W" como BLANCAS
//          // y "NEGRO"/"N"/"BLACK"/"B" como NEGRAS.
//          turn: (turn === COLOR.ROJO ? "ROJO" : "NEGRO"),
//        });
//      } catch {}
//
//    Con eso, este archivo podrá leer el turno REAL del Editor usando
//    window.__D10.get().turn y actualizar el halo automáticamente después
//    de cada jugada.
//
// 3) Guarda ambos archivos, recarga el Editor y prueba:
//      - Empiezan BLANCAS → halo en fichas blancas.
//      - Juegas una jugada legal → cambia el turno a NEGRAS
//        y el halo pasa a las fichas negras sin tocar "Cambiar turno".
//
// ──────────────────────────────────────────────────────────────

(() => {
  "use strict";

  // ───────── Config ─────────
  const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
  const log = (...a) => { if (DEBUG) console.log("[HALO]", ...a); };

  // Estilo visible (descarta problemas de stacking)
  const HALO_STYLE = {
    position: "absolute",
    inset: "-3px",
    borderRadius: "14px",
    pointerEvents: "none",
    boxShadow: "0 0 10px 3px rgba(255, 255, 0, 0.85), 0 0 4px rgba(0, 0, 0, 0.45)",
    opacity: "1",
    zIndex: "9999",
    animation: "haloPulse 1.2s ease-in-out infinite"
  };

  // Inyecta animación una sola vez
  (function injectPulseOnce() {
    if (document.getElementById("turn-halo-pulse-style")) return;
    const style = document.createElement("style");
    style.id = "turn-halo-pulse-style";
    style.textContent = `
      @keyframes haloPulse {
        0%   { transform: scale(1);    opacity: 1; }
        50%  { transform: scale(1.12); opacity: 0.7; }
        100% { transform: scale(1);    opacity: 1; }
      }`;
    document.head.appendChild(style);
  })();

  // ───────── Helpers DOM ─────────
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const inEditor = (node=document) => !!(node.closest?.('[data-page="editor"]') || $('[data-page="editor"]'));

  function getBoard() {
    const root = $('[data-page="editor"]') || document;
    const b = $("#board", root);
    if (!b) { log("No #board (¿fuera del Editor?)"); return null; }
    if (!b.style.position) b.style.position = "relative"; // para overlays
    return b;
  }

  // Selectores de piezas
  const SEL_W  = ".piece--w, .piece--wk";
  const SEL_B  = ".piece--b, .piece--bk";
  const SEL_HW = ".piece--w > [data-turn-halo='1'], .piece--wk > [data-turn-halo='1']";
  const SEL_HB = ".piece--b > [data-turn-halo='1'], .piece--bk > [data-turn-halo='1']";

  // ───────── Detección robusta del TURNO ─────────
  // 1) Lee el badge del Editor (#turno-actual con clases is-rojo / is-negro)
  // 2) Lee el texto de #turn o #turno-actual (BLANCAS / NEGRAS)
  // 3) Usa __D10.get()?.turn si está disponible (compat con Editor.js)
  // 4) Fallback (se invierte al pulsar Cambiar Turno)
  let fallbackIsWhite = true;

  function readTurnFromBadge() {
    const root = $('[data-page="editor"]');
    if (!root) return null;

    const badge = $("#turno-actual", root);
    if (badge) {
      if (badge.classList.contains("is-rojo"))  return true;  // BLANCAS
      if (badge.classList.contains("is-negro")) return false; // NEGRAS
      const txt = (badge.textContent || "").trim().toUpperCase();
      if (txt === "BLANCAS") return true;
      if (txt === "NEGRAS")  return false;
    }

    const inline = $("#turn", root);
    if (inline) {
      const t = (inline.textContent || "").trim().toUpperCase();
      if (t === "BLANCAS") return true;
      if (t === "NEGRAS")  return false;
    }
    return null;
  }

  function readTurnFromGlobal() {
    try {
      const t = window.__D10 && typeof window.__D10.get === "function" ? window.__D10.get()?.turn : undefined;
      if (!t) return null;
      const u = String(t).toUpperCase();
      if (u === "ROJO" || u === "R" || u === "WHITE" || u === "W") return true;   // BLANCAS
      if (u === "NEGRO" || u === "N" || u === "BLACK" || u === "B") return false; // NEGRAS
    } catch {}
    return null;
  }

  function isWhiteTurn() {
    const badge = readTurnFromBadge();
    if (badge !== null) return badge;
    const glob = readTurnFromGlobal();
    if (glob !== null) return glob;
    return fallbackIsWhite; // último recurso
  }

  // ───────── Pintado del halo ─────────
  function ensureHalo(pieceEl) {
    if (!pieceEl) return;
    pieceEl.style.position ||= "relative";
    let halo = pieceEl.querySelector(':scope > span[data-turn-halo="1"]');
    if (!halo) {
      halo = document.createElement("span");
      halo.setAttribute("data-turn-halo", "1");
      Object.assign(halo.style, HALO_STYLE);
      pieceEl.appendChild(halo);
    }
  }

  function clearHalo(pieceEl) {
    if (!pieceEl) return;
    const halo = pieceEl.querySelector(':scope > span[data-turn-halo="1"]');
    if (halo) halo.remove();
  }

  function counts(board) {
    return {
      w:  $$(SEL_W, board).length,
      b:  $$(SEL_B, board).length,
      hw: $$(SEL_HW, board).length,
      hb: $$(SEL_HB, board).length,
    };
  }

  // Idempotencia: si ya está correcto, no toca el DOM
  function isCorrect(board, whiteTurn) {
    const c = counts(board);
    if (whiteTurn) return c.hw === c.w && c.hb === 0;
    return c.hb === c.b && c.hw === 0;
  }

  function reapplyHalos() {
    const board = getBoard();
    if (!board) return;

    const whiteTurn = isWhiteTurn();
    if (isCorrect(board, whiteTurn)) {
      log("Sin cambios (ya correcto). Turno:", whiteTurn ? "BLANCAS" : "NEGRAS");
      return;
    }

    const whites = $$(SEL_W, board);
    const blacks = $$(SEL_B, board);

    [...whites, ...blacks].forEach(clearHalo);           // limpia todo
    (whiteTurn ? whites : blacks).forEach(ensureHalo);   // aplica al bando en turno

    const c = counts(board);
    log(`Aplicado → turno ${whiteTurn ? "BLANCAS" : "NEGRAS"} | W:${c.w} B:${c.b} | halosW:${c.hw} halosB:${c.hb}`);
  }

  // ───────── Eventos (si existen en tu flujo) ─────────
  const EVENT_NAMES = [
    "editor:applied",   // cuando una jugada termina de aplicarse (si lo emites)
    "move:applied",
    "state:paint",
    "state:changed",
    "turn:changed",
    "variant:apply"
  ];
  EVENT_NAMES.forEach(evt => {
    window.addEventListener(evt, () => { log(`Evt → ${evt}`); queueMicrotask(reapplyHalos); }, { passive: true });
  });

  // ───────── Observador mínimo del badge (sin inundación) ─────────
  let mo = null;
  function setupObserver() {
    try {
      if (mo) { mo.disconnect(); mo = null; }
      const root = $('[data-page="editor"]');
      if (!root) return;
      const badge = $("#turno-actual", root) || $("#turn", root);
      if (!badge) return;

      mo = new MutationObserver((mutList) => {
        let relevant = false;
        for (const m of mutList) {
          if (m.type === "attributes" && m.attributeName === "class") relevant = true;
          if (m.type === "characterData") relevant = true;
          if (m.type === "childList") relevant = true;
        }
        if (relevant) queueMicrotask(reapplyHalos);
      });
      // Observamos SOLO lo necesario
      mo.observe(badge, {
        attributes: true,
        attributeFilter: ["class"],
        childList: true,
        characterData: true,
        subtree: true
      });
      log("MO listo sobre badge de turno");
    } catch (e) { log("MO error", e); }
  }

  // ───────── Fallback suave (idempotente) ─────────
  let timer = null;
  function startInterval() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (!inEditor(document)) return; // no hacer nada fuera del Editor
      reapplyHalos();
    }, 900);
  }
  function stopInterval() { if (timer) { clearInterval(timer); timer = null; } }

  // ───────── Arranque / ciclo de vida ─────────
  function start() {
    setupObserver();
    startInterval();
    reapplyHalos(); // primera pasada visible
  }
  function stop() {
    stopInterval();
    if (mo) { try { mo.disconnect(); } catch {} mo = null; }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  }
  window.addEventListener("page:leaving", stop, { once: true });

  // ───────── Compat: botón "Cambiar turno" (toggle de fallback) ─────────
  window.addEventListener("click", (ev) => {
    const btn = (ev.target.closest && ev.target.closest("#btn-toggle-turn")) || null;
    if (btn) { fallbackIsWhite = !fallbackIsWhite; log("Fallback toggle turno"); queueMicrotask(reapplyHalos); }
  }, true);

  // ───────── Debug helpers ─────────
  if (!window.__D10_HALO_DEBUG__) {
    window.__D10_HALO_DEBUG__ = {
      ping()  {
        reapplyHalos();
        const b = getBoard(); if (!b) return;
        const c = counts(b), t = isWhiteTurn() ? "BLANCAS" : "NEGRAS";
        console.table({ turno: t, piezasW: c.w, piezasB: c.b, halosW: c.hw, halosB: c.hb });
      },
      force(color) {
        const b = getBoard(); if (!b) return;
        const whites = $$(SEL_W, b), blacks = $$(SEL_B, b);
        [...whites, ...blacks].forEach(clearHalo);
        (color === "white" ? whites : blacks).forEach(ensureHalo);
        const c = counts(b);
        log(`FORCE ${color} | halosW:${c.hw} halosB:${c.hb}`);
      }
    };
  }
})();
