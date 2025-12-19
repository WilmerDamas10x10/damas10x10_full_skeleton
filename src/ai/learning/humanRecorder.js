// src/ai/learning/humanRecorder.js
// Grabador anti-duplicados: SOLO jugadas humanas + FEN único + formato algebraico

import { appendMoveLine, readAllLines } from "./logMoves.js";

/**
 * Opciones:
 * - sessionId: string (para resetear dedupe al iniciar grabación)
 * - strict: si true, rechaza jugadas sin fen o sin move algebraico
 */
export function createHumanRecorder({ strict = true } = {}) {
  let enabled = false;
  let sessionId = "";
  let seen = new Set(); // fenKey vistos en ESTA sesión
  let diskIndex = null; // Set de fenKey ya en archivo (lazy)

  function normalizeFenKey(fen) {
    if (!fen || typeof fen !== "string") return "";
    // Normaliza espacios y separa "side" si viene pegado al final
    return fen.trim().replace(/\s+/g, " ");
  }

  function isAlgebraicMove(move) {
    // "c6-d7" o "c3-e5-g7" (cadenas con -)
    return typeof move === "string" && /^[a-j](10|[1-9])(-[a-j](10|[1-9]))+$/.test(move.trim());
  }

  async function buildDiskIndexOnce() {
    if (diskIndex) return diskIndex;
    diskIndex = new Set();
    const lines = await readAllLines(); // devuelve array de objetos ya parseados o líneas
    for (const it of lines) {
      const fenKey = normalizeFenKey(it?.fen || it?.k || "");
      if (fenKey) diskIndex.add(fenKey);
    }
    return diskIndex;
  }

  function start(newSessionId = String(Date.now())) {
    enabled = true;
    sessionId = newSessionId;
    seen = new Set();
    // diskIndex se mantiene (para dedupe global), si quieres reset global: diskIndex=null
  }

  function stop() {
    enabled = false;
  }

  function isEnabled() {
    return enabled;
  }

  /**
   * Registra SOLO si:
   * - enabled
   * - source === "human"
   * - move algebraico válido
   * - fen único (ni en sesión ni ya en archivo)
   */
  async function recordHumanFinalMove({ fen, side, move, meta = {} }) {
    if (!enabled) return { ok: false, reason: "disabled" };

    const fenKey = normalizeFenKey(fen);
    if (!fenKey) return strict ? { ok: false, reason: "no_fen" } : { ok: false, reason: "skip" };
    if (!isAlgebraicMove(move)) return strict ? { ok: false, reason: "bad_move_format" } : { ok: false, reason: "skip" };

    // dedupe sesión
    if (seen.has(fenKey)) return { ok: false, reason: "dup_session" };

    // dedupe archivo
    const idx = await buildDiskIndexOnce();
    if (idx.has(fenKey)) return { ok: false, reason: "dup_file" };

    // Marca vistos
    seen.add(fenKey);
    idx.add(fenKey);

    const line = {
      ts: Date.now(),
      source: "human",
      fen: fenKey,
      side: side || "",
      move: move.trim(),
      sessionId,
      ...meta,
    };

    await appendMoveLine(line);
    return { ok: true };
  }

  return {
    start,
    stop,
    isEnabled,
    recordHumanFinalMove,
  };
}
