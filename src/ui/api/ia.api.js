// ================================
// src/ui/api/ia.api.js
// Cliente para el endpoint de IA en FastAPI (/ai/move)
// ================================

const API_BASE =
  (import.meta && import.meta.env && import.meta.env.VITE_BACKEND_URL) ||
  "http://127.0.0.1:8001";

// 🔧 Helper para leer la respuesta y lanzar errores con mensaje legible
async function manejarRespuesta(resp) {
  let data = null;

  try {
    data = await resp.json();
  } catch {
    // si no viene JSON, dejamos data = null
  }

  if (!resp.ok) {
    let detalle = "Error al comunicarse con el servidor de IA";

    if (data) {
      if (Array.isArray(data.detail) && data.detail[0]?.msg) {
        detalle = data.detail[0].msg;
      } else if (typeof data.detail === "string") {
        detalle = data.detail;
      } else if (data.message) {
        detalle = data.message;
      }
    }

    const error = new Error(detalle);
    error.status = resp.status;
    error.payload = data;
    throw error;
  }

  return data;
}

/**
 * Pedir una jugada a la IA en Python.
 *
 * @param {string} fen - Posición actual en formato FEN (el mismo de __D10.fen()).
 * @param {"R"|"N"} sideToMove - Quién debe jugar: "R" (rojas/blancas) o "N" (negras).
 * @param {Array<Array<string|null>>} boardMatrix - Tablero actual como matriz 10x10.
 *
 * Devuelve un objeto con la forma:
 *   { move: string, reason?: string }
 */
export async function pedirJugadaIA(fen, sideToMove, boardMatrix) {
  const body = {
    fen,
    side_to_move: sideToMove,
    board: boardMatrix, // <<--- NUEVO: mandamos el tablero real
  };

  console.log("[IA.API] pedirJugadaIA → body enviado:", body);

  const resp = await fetch(`${API_BASE}/ai/move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await manejarRespuesta(resp);
  console.log("[IA.API] pedirJugadaIA → respuesta:", data);
  return data;
}
