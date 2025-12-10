// ================================
// src/ui/api/ia.api.js
// Cliente JS para la IA en Python (/ai/move)
// ================================

const API_BASE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_IA_API_BASE) ||
  "http://127.0.0.1:8001";

/**
 * Pedir jugada a la IA en Python.
 * @param {string} fen - FEN o JSON de la posición.
 * @param {"R"|"N"} sideToMove - Lado a mover ("R" rojas, "N" negras).
 * @param {Array<Array<string|null>>} boardSnapshot - Tablero 10x10 actual (opcional).
 */
export async function pedirJugadaIA(fen, sideToMove, boardSnapshot) {
  const payload = {
    fen,
    side_to_move: sideToMove,
    board: boardSnapshot,
  };

  let resp;
  try {
    resp = await fetch(`${API_BASE}/ai/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Sin logs en consola, solo lanzamos el error
    throw err;
  }

  let data = null;
  try {
    data = await resp.json();
  } catch {
    // Si no se puede parsear JSON, devolvemos objeto vacío
    data = {};
  }

  if (!resp.ok) {
    // Lanzamos error genérico sin loguear en consola
    const detail = (data && data.detail) || "Error en backend IA";
    throw new Error(`Error en backend IA (${resp.status}): ${detail}`);
  }

  return data || {};
}
