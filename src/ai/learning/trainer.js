// src/ai/learning/trainer.js
import { getRecentMoves } from "./logMoves.js";
import { enviarLogIA } from "../../ui/api/ia.api.js";

/**
 * Entrenamiento básico a partir de las jugadas guardadas.
 * Por ahora:
 *  - Imprime estadísticas en consola.
 *  - Envía las jugadas recientes al backend para guardarlas en disco.
 */
export async function trainModel() {
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

  // Enviar al backend para guardarlo en un archivo JSONL
  try {
    const resp = await enviarLogIA(data);
    console.info(
      "[learning] Jugadas enviadas al backend para entrenamiento:",
      resp
    );
  } catch (e) {
    console.warn("[learning] Error enviando logs al backend:", e);
  }

  // más adelante: ajustar pesos reales a partir de estos datos
}
