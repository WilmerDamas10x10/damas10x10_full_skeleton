// ===============================================
// src/ui/pages/Online/ui.selection.js
// UI de selección remota/local (aro/halo alrededor
// de la ficha) + envío de "select" al otro lado.
// Extraído de mountOnline.js
// ===============================================

/**
 * @typedef {Object} SelectionOpts
 * @property {HTMLElement|null} boardEl
 * @property {() => any[][]} getBoard
 * @property {Object} COLOR
 * @property {Function} colorOf
 * @property {(msg: any) => void} netSend
 */

/**
 * Inicializa:
 *  - El listener pointerdown sobre el tablero para enviar t:"ui"/op:"select"
 *  - La función highlightSelected(pos) para pintar el halo
 *
 * Devuelve:
 *  { highlightSelected }
 *
 * Si falta algo crítico (boardEl o netSend), devuelve no-op.
 *
 * @param {SelectionOpts} opts
 */
export function setupSelectionHighlight(opts) {
  const { boardEl, getBoard, COLOR, colorOf, netSend } = opts || {};

  if (!boardEl || typeof netSend !== "function") {
    return { highlightSelected: () => {} };
  }

  // --- Helper local: validar celda lógica ---
  function safeCell(p) {
    return (
      Array.isArray(p) &&
      p.length === 2 &&
      Number.isInteger(p[0]) &&
      Number.isInteger(p[1]) &&
      p[0] >= 0 &&
      p[1] >= 0 &&
      p[0] < 10 &&
      p[1] < 10
    );
  }

  // Halo de selección REMOTO/LOCAL independiente del motor
  let remoteHalo = null;

  /**
   * Dibuja un aro alrededor de la casilla (r,c) seleccionada.
   * Usa la celda real [data-r][data-c] para que coincida EXACTO
   * con la pieza, respetando cualquier orientación/transform.
   *
   * @param {[number, number]} pos Coordenadas lógicas [r,c] 0..9
   */
  function highlightSelected(pos) {
    if (!boardEl) return;
    if (!pos || !Array.isArray(pos) || pos.length !== 2) return;

    const [r, c] = pos;
    if (!safeCell([r, c])) return;

    const board = typeof getBoard === "function" ? getBoard() : null;

    // Buscar la celda DOM exacta
    const cell = boardEl.querySelector(
      `[data-r="${r}"][data-c="${c}"]`
    );
    if (!cell) {
      console.warn("[Online] highlightSelected: no se encontró celda para", {
        r,
        c,
      });
      return;
    }

    // Crear el halo una sola vez
    if (!remoteHalo) {
      remoteHalo = document.createElement("div");
      const s = remoteHalo.style;

      s.position = "absolute";
      s.inset = "0"; // ocupa toda la celda
      s.pointerEvents = "none";
      s.boxSizing = "border-box";
      s.borderRadius = "50%";
      s.zIndex = "5";
      s.transition = "all 80ms ease-out";

      // Fondo suave verde translúcido
      s.backgroundColor = "rgba(0, 255, 0, 0.14)";
    }

    // Asegurar que la celda pueda alojar hijos posicionados
    const cs = window.getComputedStyle(cell);
    if (cs.position === "static") {
      cell.style.position = "relative";
    }

    // Calcular grosor del borde en función del ancho de la celda
    const rect = cell.getBoundingClientRect();
    const cellW = rect.width || (cell.offsetWidth || 40);
    const thickness = Math.max(3, Math.round(cellW * 0.09));

    // Elegir color del borde según la pieza (negro/blanco)
    let ch = "";
    try {
      ch = board?.[r]?.[c] ?? "";
    } catch {}

    let borderColor = "#00ff00"; // fallback verde
    if (ch) {
      try {
        const col = colorOf(ch);
        borderColor = col === COLOR.NEGRO ? "#ffffff" : "#000000";
      } catch {
        borderColor = "#00ff00";
      }
    }

    remoteHalo.style.border = `${thickness}px solid ${borderColor}`;
    remoteHalo.style.boxShadow =
      "0 0 8px 3px rgba(0, 255, 0, 0.5)";

    // Mover el halo a la nueva celda
    if (remoteHalo.parentElement !== cell) {
      try {
        remoteHalo.parentElement?.removeChild(remoteHalo);
      } catch {}
      cell.appendChild(remoteHalo);
    }

    console.log("[Online] highlightSelected()", { r, c });
  }

  // ================================
  // 🟢 Enviar selección al otro lado
  // ================================
  boardEl.addEventListener("pointerdown", (ev) => {
    try {
      // Buscar la casilla [data-r][data-c] donde se hizo clic
      const cell = ev.target.closest("[data-r][data-c]");
      if (!cell || !boardEl.contains(cell)) return;

      const rAttr = cell.getAttribute("data-r");
      const cAttr = cell.getAttribute("data-c");
      if (rAttr == null || cAttr == null) return;

      const r = Number(rAttr);
      const c = Number(cAttr);
      if (!Number.isInteger(r) || !Number.isInteger(c)) return;

      // Solo si hay una pieza en esa casilla
      const piece = cell.querySelector(".piece");
      if (!piece) return;

      const pos = [r, c];

      // Enviamos posición lógica (r,c) al resto de la sala
      netSend({
        t: "ui",
        op: "select",
        pos,
      });

      console.log("[Online] select SEND (pointerdown)", pos);
    } catch (e) {
      console.warn("[Online] Error enviando select remoto:", e);
    }
  });

  return { highlightSelected };
}
