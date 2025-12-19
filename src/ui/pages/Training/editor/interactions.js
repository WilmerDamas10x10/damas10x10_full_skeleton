// src/ui/pages/Training/editor/interactions.js
import { createInteractionsController } from "./interactions.controller.js";
import { onMove, onCaptureHop, onCrown, onInvalid } from "../../../sfx.hooks.js";

// ✅ IA capture (Editor -> experiencia)
// OJO: ya NO grabamos con recordAIMove aquí; solo usamos el flag isAICapturing()
import { isAICapturing } from "./lib/ai.captureSession.js";

// ✅ Grabación limpia HUMANA (FEN único + move algebraico)
import { recordHumanFinalMove } from "../../../../ai/learning/logMoves.js";

// ✅ DEBUG: confirma que ESTE archivo se está cargando
console.log("[INTERACTIONS] Training/editor/interactions.js cargado ✅ (v-diff-board)");

export function attachBoardInteractions(container, ctx) {
  const boardEl = container.querySelector("#board");
  if (!boardEl) return;

  console.log("[INTERACTIONS] attachBoardInteractions() montado ✅", { hasBoard: !!boardEl });

  const ctrl = createInteractionsController(container, ctx);
  console.log("[INTERACTIONS] controller creado ✅ keys:", Object.keys(ctrl || {}));

  // ————————————————————————————————————————————————
  // MICRO-GUARD: Coalescer anti-duplicados por tipo de evento
  // ————————————————————————————————————————————————
  const COALESCE_MS = 120;
  const lastFired = new Map(); // type -> timestamp

  function fireOnce(type, fn) {
    const now = performance.now ? performance.now() : Date.now();
    const last = lastFired.get(type) || 0;
    if (now - last < COALESCE_MS) return;
    lastFired.set(type, now);
    try { fn(); } catch {}
  }

  const fireMove    = () => fireOnce("move", onMove);
  const fireCapture = () => fireOnce("capture", onCaptureHop);
  const fireCrown   = () => fireOnce("crown", onCrown);
  const fireInvalid = () => fireOnce("invalid", onInvalid);

  // ————————————————————————————————————————————————
  // HELPERS — conversión a algebra 10×10
  // ————————————————————————————————————————————————
  const FILES_10 = "abcdefghij";

  function rcToAlg10(rc) {
    if (!Array.isArray(rc) || rc.length !== 2) return null;
    const [r, c] = rc;
    if (r < 0 || r > 9 || c < 0 || c > 9) return null;
    const file = FILES_10[c];
    const rank = 10 - r; // row 9 => 1, row 0 => 10 (top->10, bottom->1)
    return `${file}${rank}`;
  }

  function moveFromToToAlg(from, to) {
    const a = rcToAlg10(from);
    const b = rcToAlg10(to);
    if (!a || !b) return null;
    return `${a}-${b}`;
  }

  // ————————————————————————————————————————————————
  // Helpers para leer tablero / turno
  // ————————————————————————————————————————————————
  function getSideForCaptureRaw() {
    try {
      if (typeof ctx?.getTurn === "function") return ctx.getTurn();
      if (typeof ctx?.turn === "string") return ctx.turn;
      if (typeof container?.turn === "string") return container.turn;
    } catch {}
    return null;
  }

  function normalizeSide(sideRaw) {
    const s = String(sideRaw ?? "R").trim().toUpperCase();
    if (s === "R" || s === "ROJO" || s === "WHITE" || s === "W" || s === "BLANCO" || s === "BLANCAS") return "R";
    if (s === "N" || s === "NEGRO" || s === "BLACK" || s === "B" || s === "NEGRAS") return "N";
    // fallback: si empieza con R -> R, caso contrario N
    return s.startsWith("R") ? "R" : "N";
  }

  function getBoardForCapture() {
    try {
      if (typeof ctx?.getBoard === "function") return ctx.getBoard();
      if (Array.isArray(ctx?.board)) return ctx.board;
      if (Array.isArray(container?.board)) return container.board;
    } catch {}
    return null;
  }

  function cloneBoard10(b) {
    if (!Array.isArray(b)) return null;
    return b.map(row => (Array.isArray(row) ? row.slice() : row));
  }

  // ————————————————————————————————————————————————
  // ✅ Board-diff: inferir from/to aunque onClick() devuelva undefined
  // ————————————————————————————————————————————————
  function inferFromToByDiff(before, after) {
    if (!Array.isArray(before) || !Array.isArray(after)) return null;
    if (before.length !== 10 || after.length !== 10) return null;

    const froms = [];
    const tos = [];

    for (let r = 0; r < 10; r++) {
      const br = before[r];
      const ar = after[r];
      if (!Array.isArray(br) || !Array.isArray(ar) || br.length !== 10 || ar.length !== 10) return null;

      for (let c = 0; c < 10; c++) {
        const b = br[c];
        const a = ar[c];
        if (b === a) continue;

        if (b != null && a == null) froms.push([r, c]);
        if (b == null && a != null) tos.push([r, c]);

        // coronación / reemplazo
        if (b != null && a != null) {
          tos.push([r, c]);
        }
      }
    }

    if (froms.length < 1 || tos.length < 1) return null;

    const from = froms[0];
    const to = tos[tos.length - 1];

    return { from, to, froms, tos };
  }

  // ✅ CLAVE: grabar experiencia HUMANA con tablero y lado ANTES del movimiento
  function captureExperienceFromFromTo(from, to, kind = "move", beforeBoard, beforeSideRaw) {
    // Respeta tu switch actual: solo grabar cuando el usuario activa la captura
    if (!isAICapturing()) return;

    // 🛑 FILTRO DEFENSIVO: si el contexto indica origen IA/Python, NO grabar
    // (esto evita las líneas extra tipo origin:"python")
    const ctxMode = String(ctx?.mode ?? "").toLowerCase();
    const ctxOrigin = String(ctx?.origin ?? "").toLowerCase();
    if (ctxMode === "ai" || ctxOrigin === "python" || ctxOrigin === "backend") {
      console.log("[CAPTURE] skip (no-humano):", { ctxMode, ctxOrigin });
      return;
    }

    const moveAlg = moveFromToToAlg(from, to);
    if (!moveAlg) {
      console.log("[CAPTURE DEBUG] no se pudo construir moveAlg desde from/to", { from, to });
      return;
    }

    const fen = beforeBoard;                   // ✅ BEFORE board
    const side = normalizeSide(beforeSideRaw); // ✅ BEFORE side, normalizado

    console.log("[CAPTURE DEBUG] moveAlg (diff):", moveAlg, "side(before):", side);

    try {
      const res = recordHumanFinalMove({
        fen,
        side,
        move: moveAlg,
        sessionId: "training",
        meta: {
          source: "Training/editor/interactions.js",
          kind,
          via: "board-diff",
          timing: "before-move",
          origin: "human_click", // ✅ marcamos explícito: HUMANO
        },
      });

      // log suave por si fue duplicado o formato inválido
      if (!res?.ok) {
        console.log("[CAPTURE] skip:", res);
      }
    } catch (e) {
      console.warn("[CAPTURE] recordHumanFinalMove falló:", e);
    }
  }

  // ————————————————————————————————————————————————
  // EVENTOS CUSTOM (por si existen)
  // ————————————————————————————————————————————————
  const onMoveEvent    = () => fireMove();
  const onCaptureEvent = () => fireCapture();
  const onCrownEvent   = () => fireCrown();
  const onInvalidEvent = () => fireInvalid();

  boardEl.addEventListener("move:ok", onMoveEvent);
  boardEl.addEventListener("capture:hop", onCaptureEvent);
  boardEl.addEventListener("crown", onCrownEvent);
  boardEl.addEventListener("move:invalid", onInvalidEvent);

  container.addEventListener?.("move:ok", onMoveEvent);
  container.addEventListener?.("capture:hop", onCaptureEvent);
  container.addEventListener?.("crown", onCrownEvent);
  container.addEventListener?.("move:invalid", onInvalidEvent);

  // ————————————————————————————————————————————————
  // ✅ WRAP onClick: aquí hacemos board-diff + CAPTURA BEFORE-MOVE
  // ————————————————————————————————————————————————
  const originalOnClick = ctrl.onClick?.bind(ctrl);

  async function onClickWrapped(ev) {
    // ✅ snapshots BEFORE
    const beforeBoard = cloneBoard10(getBoardForCapture());
    const beforeSideRaw = getSideForCaptureRaw();

    let result;

    try {
      result = originalOnClick ? originalOnClick(ev) : undefined;
      if (result instanceof Promise) result = await result;
    } catch (err) {
      fireInvalid();
      throw err;
    }

    // Espera microtask para que el DOM/motor termine de aplicar
    await new Promise((r) => setTimeout(r, 0));

    const afterBoard = cloneBoard10(getBoardForCapture());
    const diff = inferFromToByDiff(beforeBoard, afterBoard);

    if (!diff) return result;

    fireMove();

    const manyChanges = (diff.froms?.length || 0) + (diff.tos?.length || 0) >= 3;
    if (manyChanges) fireCapture();

    // ✅ EXPERIENCIA con BEFORE board/side (solo si captura activada)
    captureExperienceFromFromTo(
      diff.from,
      diff.to,
      manyChanges ? "captureHop" : "move",
      beforeBoard,
      beforeSideRaw
    );

    return result;
  }

  boardEl.addEventListener("click", onClickWrapped);

  return function detachBoardInteractions() {
    boardEl.removeEventListener("click", onClickWrapped);

    boardEl.removeEventListener("move:ok", onMoveEvent);
    boardEl.removeEventListener("capture:hop", onCaptureEvent);
    boardEl.removeEventListener("crown", onCrownEvent);
    boardEl.removeEventListener("move:invalid", onInvalidEvent);

    container.removeEventListener?.("move:ok", onMoveEvent);
    container.removeEventListener?.("capture:hop", onCaptureEvent);
    container.removeEventListener?.("crown", onCrownEvent);
    container.removeEventListener?.("move:invalid", onInvalidEvent);
  };
}
