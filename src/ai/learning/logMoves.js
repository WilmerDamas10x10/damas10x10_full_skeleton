// src/ai/learning/logMoves.js
// Registro básico de jugadas para entrenamiento posterior

export const moveLog = [];

/**
 * Guarda una jugada (posición inicial, jugada elegida y resultado final)
 * @param {Object} entry - datos a guardar
 * @param {string} entry.fen - posición en formato FEN o equivalente
 * @param {string} entry.move - jugada realizada (p.ej. "b6-a5")
 * @param {number} entry.score - valoración del resultado (ej: +1 victoria, 0 empate, -1 derrota)
 */
export function recordMove(entry) {
  try {
    moveLog.push({
      ts: Date.now(),
      ...entry
    });
  } catch (e) {
    console.warn("[learning] Error registrando jugada:", e);
  }
}

/**
 * Devuelve las últimas N jugadas registradas
 */
export function getRecentMoves(limit = 50) {
  return moveLog.slice(-limit);
}

/**
 * Limpia el registro (por partida)
 */
export function clearMoves() {
  moveLog.length = 0;
}
