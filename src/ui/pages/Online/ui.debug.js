// ===============================================
// src/ui/pages/Online/ui.debug.js
// Panel DEBUG para cargar tablero en modo Online.
// Extraído de mountOnline.js — solo UI.
// Reutiliza parseTextBoard desde lib/debug.js
// ===============================================

import { parseTextBoard } from "./lib/debug.js";

/**
 * Devuelve el HTML del panel DEBUG si está habilitado.
 * Si no, devuelve cadena vacía.
 */
export function getDebugPanelHTML(debugEnabled) {
  if (!debugEnabled) return "";
  return `
      <details class="card" style="padding:10px 12px; margin-top:8px;">
        <summary class="btn btn--subtle" style="cursor:pointer;">DEBUG · Cargar tablero</summary>
        <div class="row" style="gap:12px; margin-top:8px; align-items:flex-start; flex-wrap:wrap;">
          <textarea id="dbg-board-text" rows="10" cols="34" style="font-family:monospace; line-height:1.25; resize:vertical;"></textarea>
          <div class="col" style="gap:8px; min-width:220px;">
            <label class="btn btn--subtle">Turno:
              <select id="dbg-turn" class="btn" style="margin-left:6px;">
                <option value="R">R</option>
                <option value="N">N</option>
              </select>
            </label>

            <label class="btn btn--subtle" title="Si se pega un tablero mal alineado, limpia piezas en casillas claras">
              <input type="checkbox" id="dbg-force-parity" style="margin-right:6px;">
              Forzar casillas válidas (oscuras)
            </label>

            <div class="row" style="gap:8px; flex-wrap:wrap;">
              <button class="btn" id="dbg-apply-local" title="Aplica sólo en esta pestaña">Aplicar (solo aquí)</button>
              <button class="btn" id="dbg-apply-send"  title="Aplica aquí y envía snapshot a la sala">Aplicar y ENVIAR</button>
            </div>
            <small class="muted">Formato: 10×10 (r,n,R,N, . / - / 0) o JSON 10×10.</small>
          </div>
        </div>
      </details>
  `;
}

/**
 * Conecta el panel DEBUG con el estado real del tablero.
 * Si el HTML no está presente (DEBUG desactivado), no hace nada.
 */
export function setupDebugPanel(opts) {
  const {
    container,
    SIZE,
    COLOR,
    sanitizeBoard,
    scrubNonPlayableSquares,
    getBoard,
    setBoard,
    getTurn,
    setTurn,
    setStepState,
    render,
    paintState,
    setTurnText,
    updateLock,
    netSendState,
    syncMon,
    updateMetricsUI,
    boardToAscii, // función ya preparada que viene desde mountOnline
  } = opts || {};

  if (!container || !SIZE || !COLOR || !sanitizeBoard) return;

  const $dbgText  = container.querySelector("#dbg-board-text");
  const $dbgTurn  = container.querySelector("#dbg-turn");
  const $dbgApply = container.querySelector("#dbg-apply-local");
  const $dbgSend  = container.querySelector("#dbg-apply-send");
  const $dbgForce = container.querySelector("#dbg-force-parity");

  // Si no existe el panel en el DOM, salimos silenciosamente
  if (!$dbgText || !$dbgTurn) return;

  // --- Prefill inicial: tablero actual y turno actual ---
  try {
    const b = typeof getBoard === "function" ? getBoard() : null;
    if (b && typeof boardToAscii === "function") {
      $dbgText.value = boardToAscii(b);
    }
  } catch {}

  try {
    const t = typeof getTurn === "function" ? getTurn() : null;
    if (t === COLOR.ROJO) $dbgTurn.value = "R";
    else if (t === COLOR.NEGRO) $dbgTurn.value = "N";
  } catch {}

  // --- Aplicar solo localmente ---
  $dbgApply?.addEventListener("click", () => {
    try {
      const raw = $dbgText.value || "";
      const newBoardRaw = parseTextBoard(raw, SIZE);
      const newTurn =
        $dbgTurn.value === "N" ? COLOR.NEGRO : COLOR.ROJO;

      let newBoard;
      if ($dbgForce?.checked) {
        const isPlayable = (r, c) => ((r + c) % 2) === 1;
        newBoard = sanitizeBoard(
          scrubNonPlayableSquares(newBoardRaw, isPlayable)
        );
      } else {
        newBoard = sanitizeBoard(newBoardRaw);
      }

      // Actualizar estado compartido
      if (typeof setBoard === "function") setBoard(newBoard);
      if (typeof setTurn === "function") setTurn(newTurn);
      if (typeof setStepState === "function") setStepState(null);

      render?.();
      paintState?.();
      setTurnText?.();
      updateLock?.();
      syncMon?.onLocalChange?.();
      updateMetricsUI?.();
    } catch (e) {
      alert("Error: " + e.message);
    }
  });

  // --- Aplicar y ENVIAR snapshot a la sala ---
  $dbgSend?.addEventListener("click", () => {
    try {
      const raw = $dbgText.value || "";
      const newBoardRaw = parseTextBoard(raw, SIZE);
      const newTurn =
        $dbgTurn.value === "N" ? COLOR.NEGRO : COLOR.ROJO;

      let newBoard;
      if ($dbgForce?.checked) {
        const isPlayable = (r, c) => ((r + c) % 2) === 1;
        newBoard = sanitizeBoard(
          scrubNonPlayableSquares(newBoardRaw, isPlayable)
        );
      } else {
        newBoard = sanitizeBoard(newBoardRaw);
      }

      if (typeof setBoard === "function") setBoard(newBoard);
      if (typeof setTurn === "function") setTurn(newTurn);
      if (typeof setStepState === "function") setStepState(null);

      render?.();
      paintState?.();
      setTurnText?.();
      updateLock?.();
      netSendState?.();
      syncMon?.onLocalChange?.();
      updateMetricsUI?.();
    } catch (e) {
      alert("Error: " + e.message);
    }
  });
}
