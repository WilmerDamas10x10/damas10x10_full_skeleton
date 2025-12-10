// ================================
// src/ai/learning/logMoves.js
// Registro de jugadas para aprendizaje de la IA
// ================================

// Solo queremos ver logs si la URL tiene ?debugIA=1
const DEBUG_IA_LEARNING =
  typeof window !== "undefined" &&
  typeof window.location !== "undefined" &&
  window.location.search.includes("debugIA=1");

const _moves = [];

/**
 * Registra una jugada para aprendizaje.
 * entry: { fen: string, move: string, score: number, ... }
 */
export function recordMove(entry) {
  try {
    _moves.push(entry);

    if (DEBUG_IA_LEARNING) {
      console.log("[logMoves] Registrando jugada:", entry);
      console.log("[logMoves] Total acumulado:", _moves.length);
    }

    // Opcional: persistir en localStorage para análisis offline
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("d10_ai_moves", JSON.stringify(_moves));
    }
  } catch (err) {
    if (DEBUG_IA_LEARNING) {
      console.warn("[logMoves] Error registrando jugada:", err);
    }
  }
}

/**
 * Devuelve una copia de todas las jugadas registradas.
 */
export function getMoves() {
  return _moves.slice();
}

export function getRecentMoves(limit = 50) {
  return _moves.slice(-limit);
}
