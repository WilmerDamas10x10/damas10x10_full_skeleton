// src/ui/pages/Training/editor/turn.safe.js
// Indicador mínimo y SEGURO: SOLO dentro del Editor, sin depender de imports.

(function () {
  "use strict";

  var TINT_WHITE = "rgba(180,220,255,0.18)";
  var TINT_BLACK = "rgba(255,200,160,0.16)";
  var BADGE_WHITE = "Turno: BLANCAS";
  var BADGE_BLACK = "Turno: NEGRAS";

  function $(s, r){ return (r||document).querySelector(s); }

  function getEditorRoot() {
    return document.querySelector('[data-page="editor"]') || null;
  }
  function getBoardHost(root) {
    return (root && $("#board", root)) || null;
  }

  var fallbackIsWhite = true;
  function isWhiteTurn() {
    try {
      if (window.__D10 && typeof window.__D10.get === "function") {
        var t = window.__D10.get()?.turn;
        if (t === "NEGRO" || t === "N" || t === "black") return false;
        if (t === "ROJO"  || t === "R" || t === "white") return true;
      }
    } catch (e) {}
    return fallbackIsWhite;
  }

  var tintEl = null, badgeEl = null;
  function applyTint() {
    var root  = getEditorRoot();
    var board = getBoardHost(root);
    if (!root || !board) { removeTint(); return; } // ← fuera del Editor

    if (!board.style.position) board.style.position = "relative";

    if (!tintEl) {
      tintEl = document.createElement("div");
      tintEl.setAttribute("data-turn-tint","1");
      Object.assign(tintEl.style, {
        position:"absolute", inset:"0", pointerEvents:"none",
        borderRadius:"12px", transition:"background-color .25s ease"
      });
      board.appendChild(tintEl);
    }
    if (!badgeEl) {
      badgeEl = document.createElement("div");
      badgeEl.setAttribute("data-turn-badge","1");
      Object.assign(badgeEl.style, {
        position:"absolute", top:"8px", right:"8px",
        font:"600 12px/1.1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        padding:"6px 8px", borderRadius:"8px",
        background:"rgba(255,255,255,.75)", color:"#111",
        pointerEvents:"none", boxShadow:"0 1px 4px rgba(0,0,0,.15)"
      });
      board.appendChild(badgeEl);
    }

    var white = isWhiteTurn();
    tintEl.style.backgroundColor = white ? TINT_WHITE : TINT_BLACK;
    badgeEl.textContent = white ? BADGE_WHITE : BADGE_BLACK;
  }

  function removeTint() {
    try { tintEl && tintEl.remove(); } catch (e) {}
    try { badgeEl && badgeEl.remove(); } catch (e) {}
    tintEl = badgeEl = null;
  }

  function safeInit() {
    applyTint();

    document.addEventListener("click", function (ev) {
      try {
        var t = ev.target;
        var isBtn = t && (t.id === "btn-cambiar-turno" || (t.closest && t.closest("#btn-cambiar-turno")));
        if (isBtn) {
          fallbackIsWhite = !fallbackIsWhite;
          setTimeout(applyTint, 0);
        }
      } catch (e) {}
    }, true);

    ["move:applied","state:paint","turn:changed","variant:apply"].forEach(function (evt) {
      document.addEventListener(evt, function () { try { applyTint(); } catch (e) {} });
    });

    // Limpieza si abandonas la vista del editor (si tu router emite este evento)
    document.addEventListener("page:leaving", removeTint);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(safeInit, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(safeInit, 0); }, { once: true });
  }
})();
