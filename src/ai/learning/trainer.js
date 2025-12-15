// src/ai/learning/trainer.js
// Entrenamiento (fase inicial): toma jugadas recientes de logMoves.js y las envía al backend.
// ✅ Arregla el 404: ya no depende de enviarLogIA(), usa /ai/train (y fallback /ai/log-moves)
// ✅ Respeta __AI_API_BASE si lo tienes configurado (p.ej. http://127.0.0.1:8001)

import { getRecentMoves } from "./logMoves.js";

function _guessBase() {
  try { return String(window.__AI_API_BASE || "").trim(); } catch {}
  return "";
}

async function _postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  return {
    ok: res.ok,
    status: res.status,
    url,
    responseText: text?.slice?.(0, 300) || "",
    responseJson: json,
  };
}

async function enviarAlBackend(moves) {
  const base = _guessBase();
  const mk = (path) => (base ? `${base}${path}` : path);

  // 1) endpoint nuevo recomendado
  let out = await _postJson(mk("/ai/train"), { moves });

  // 2) fallback legacy si /ai/train no existe (404)
  if (!out.ok && out.status === 404) {
    out = await _postJson(mk("/ai/log-moves"), moves);
  }

  return out;
}

export async function trainModel() {
  console.log("[learning] trainModel()");

  const data = getRecentMoves(200);
  console.log("[learning] getRecentMoves(200) count =", data.length);

  if (!data.length) {
    console.info("[learning] No hay jugadas para entrenar (logMoves.js está vacío).");
    return { ok: true, sent: 0, empty: true };
  }

  const total = data.length;
  const wins = data.filter((d) => d.score > 0).length;
  const losses = data.filter((d) => d.score < 0).length;
  const draws = total - wins - losses;

  console.table({ total, wins, losses, draws });

  const resp = await enviarAlBackend(data);
  if (resp.ok) console.info("[learning] Jugadas enviadas al backend:", resp);
  else console.warn("[learning] Error enviando logs al backend:", resp);

  return resp;
}
