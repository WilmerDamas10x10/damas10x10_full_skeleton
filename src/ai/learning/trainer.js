// src/ai/learning/trainer.js
import { getRecentMoves } from "./logMoves.js";

/**
 * Entrenamiento básico a partir de las jugadas guardadas.
 * Por ahora solo imprime estadísticas.
 */
export function trainModel() {
  const data = getRecentMoves(200);
  if (!data.length) {
    console.info("[learning] No hay jugadas para entrenar.");
    return;
  }

  const total = data.length;
  const wins = data.filter(d => d.score > 0).length;
  const losses = data.filter(d => d.score < 0).length;
  const draws = total - wins - losses;

  console.table({
    total,
    wins,
    losses,
    draws
  });

  // más adelante: exportar a JSON, ajustar pesos, etc.
}
