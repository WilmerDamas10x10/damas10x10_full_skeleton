// =============================================
// src/ui/pages/Online/turn.halo.js
// Halo de turno (brillo suave) en modo Online,
// inspirado en el Editor / modo Entrenamiento.
// =============================================
(() => {
  "use strict";

  // Estilo del halo (brillo suave alrededor de la ficha)
  const HALO_STYLE = {
    position: "absolute",
    inset: "-3px",
    borderRadius: "14px",
    pointerEvents: "none",
   boxShadow: "0 0 10px 3px rgba(255, 255, 0, 0.9)", // un poco más intenso
  opacity: "1",                                      // un pelín más visible
    transition: "box-shadow 180ms ease-out, opacity 180ms ease-out",
  };

  const ROOT_SELECTOR =
    '[data-page="online"], [data-page="online-mode"], .online-layout';

  const WHITE_SELECTOR = ".piece--w, .piece--wk";
  const BLACK_SELECTOR = ".piece--b, .piece--bk";

  function getRoot() {
    try {
      return (
        document.querySelector(ROOT_SELECTOR) ||
        document.querySelector("#app") ||
        document.body ||
        document
      );
    } catch {
      return document;
    }
  }

  // Lee el turno actual a partir del texto de #turn-info:
  // Ejemplo: "Turno: ROJO · Tú: ROJO"
  function getTurnSideFromDOM(root) {
    try {
      const ti = root.querySelector("#turn-info");
      if (!ti) return null;
      const text = (ti.textContent || "").toUpperCase();
      const m = text.match(/TURNO:\s*(ROJO|NEGRO)/);
      if (!m) return null;
      // En tus reglas: ROJO = BLANCAS, NEGRO = NEGRAS
      return m[1]; // "ROJO" o "NEGRO"
    } catch {
      return null;
    }
  }

  function clearTurnHalos(boardEl) {
    try {
      boardEl
        .querySelectorAll('[data-turn-halo-online="1"]')
        .forEach((el) => el.remove());
    } catch {}
  }

  function ensurePieceRelative(piece) {
    try {
      const cs = getComputedStyle(piece);
      if (cs.position === "static" || !cs.position) {
        piece.style.position = "relative";
      }
    } catch {}
  }

  function applyTurnHaloOnline() {
    try {
      const root = getRoot();
      if (!root) return;

      const boardEl = root.querySelector("#board");
      const turnInfo = root.querySelector("#turn-info");
      if (!boardEl || !turnInfo) return;

      // Limpiar halos anteriores
      clearTurnHalos(boardEl);

      const side = getTurnSideFromDOM(root);
      if (!side) return;

      const selector = side === "ROJO" ? WHITE_SELECTOR : BLACK_SELECTOR;
      const pieces = boardEl.querySelectorAll(selector);
      if (!pieces.length) return;

      pieces.forEach((piece) => {
        ensurePieceRelative(piece);
        let halo = piece.querySelector('[data-turn-halo-online="1"]');
        if (!halo) {
          halo = document.createElement("span");
          halo.setAttribute("data-turn-halo-online", "1");
          Object.assign(halo.style, HALO_STYLE);
          piece.appendChild(halo);
        }
      });
    } catch {
      // Cualquier error se ignora para no romper el juego
    }
  }

  function boot() {
    // Intentamos aplicar cada cierto tiempo para:
    // - cuando cambia el turno,
    // - cuando se redibuja el tablero al sincronizar online.
    try {
      applyTurnHaloOnline();
    } catch {}

    // Refresco periódico muy ligero
    setInterval(() => {
      try {
        applyTurnHaloOnline();
      } catch {}
    }, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      try { boot(); } catch {}
    }, { once: true });
  } else {
    try { boot(); } catch {}
  }
})();
