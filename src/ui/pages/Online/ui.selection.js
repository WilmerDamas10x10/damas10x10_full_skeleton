// ================================
// src/ui/pages/Online/ui.selection.js
// Highlighter de selección LOCAL / REMOTO para modo Online
// -------------------------------
// - No toca el motor, solo DOM.
// - Devuelve una función highlightSelected([r,c]) que puedes
//   usar tanto para clic local como para select remoto.
// - La apariencia se controla por CSS (.d10-selection-halo*).
// ================================

/**
 * @typedef {Object} RemoteHaloOpts
 * @property {HTMLElement} boardEl      // #board
 * @property {() => string[][]} getBoard
 * @property {(ch:string) => any} colorOf
 * @property {{ROJO:any, NEGRO:any}} COLOR
 */

/**
 * Crea un highlighter reutilizable.
 * @param {RemoteHaloOpts} opts
 * @returns {(pos:[number,number]) => void}
 */
export function createRemoteSelectionHighlighter(opts) {
  var boardEl = opts && opts.boardEl;
  var getBoard = opts && opts.getBoard;
  var colorOf = opts && opts.colorOf;
  var COLOR = opts && opts.COLOR;

  if (!boardEl) {
    // Por si algo va raro, devolvemos un no-op.
    return function noop() {};
  }

  /** @type {HTMLDivElement|null} */
  var haloEl = null;

  function safeCell(pos) {
    if (!pos || !Array.isArray(pos) || pos.length !== 2) return false;
    var r = pos[0];
    var c = pos[1];
    return (
      typeof r === "number" &&
      typeof c === "number" &&
      !isNaN(r) &&
      !isNaN(c)
    );
  }

  /**
   * Dibuja el aro sobre la celda [r,c].
   * @param {[number,number]} pos
   */
  function highlightSelected(pos) {
    if (!safeCell(pos)) return;

    var r = pos[0];
    var c = pos[1];

    // Buscar celda DOM correspondiente
    var selector = '[data-r="' + r + '"][data-c="' + c + '"]';
    var cell = boardEl.querySelector(selector);
    if (!cell) {
      return;
    }

    // Crear halo una sola vez
    if (!haloEl) {
      haloEl = document.createElement("div");
      haloEl.className = "d10-selection-halo";
    }

    // Asegurar que la celda pueda alojar elementos posicionados
    var cs = window.getComputedStyle(cell);
    if (cs.position === "static") {
      cell.style.position = "relative";
    }

    // Determinar color de pieza en esa casilla (si hay)
    var board = typeof getBoard === "function" ? getBoard() : null;
    var ch = "";
    if (board && board[r]) {
      ch = board[r][c] || "";
    }

    var colorClass = "";
    if (ch && typeof colorOf === "function" && COLOR) {
      try {
        var pieceColor = colorOf(ch);
        if (pieceColor === COLOR.NEGRO) {
          colorClass = "d10-selection-halo--negro";
        } else {
          colorClass = "d10-selection-halo--rojo";
        }
      } catch (e) {
        colorClass = "d10-selection-halo--rojo";
      }
    }

    // Resetear clases base y aplicar modificador de color
    haloEl.className = "d10-selection-halo";
    if (colorClass) {
      haloEl.className += " " + colorClass;
    }

    // Grosor del borde en función del tamaño de la celda
    var rect = cell.getBoundingClientRect();
    var cellW = rect.width || cell.offsetWidth || 40;
    var thickness = Math.max(3, Math.round(cellW * 0.11)); // 🔎 un pelín más gordito
    haloEl.style.borderWidth = thickness + "px";

    // Reubicar halo en la celda actual
    if (haloEl.parentElement && haloEl.parentElement !== cell) {
      try {
        haloEl.parentElement.removeChild(haloEl);
      } catch (e) {}
    }
    if (!haloEl.parentElement) {
      cell.appendChild(haloEl);
    }
  }

  return highlightSelected;
}
