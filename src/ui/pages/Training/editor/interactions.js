// src/ui/pages/Training/editor/interactions.js
import { createInteractionsController } from "./interactions.controller.js";
import { onMove, onCaptureHop, onCrown, onInvalid } from "../../../sfx.hooks.js";

// ✅ IA capture (Editor -> experiencia)
import { recordAIMove, isAICapturing } from "./lib/ai.captureSession.js";

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
  // HELPERS IA — conversión a algebra 10×10
  // ————————————————————————————————————————————————
  const FILES_10 = "abcdefghij";

  function rcToAlg10(rc) {
    if (!Array.isArray(rc) || rc.length !== 2) return null;
    const [r, c] = rc;
    if (r < 0 || r > 9 || c < 0 || c > 9) return null;
    const file = FILES_10[c];
    const rank = 10 - r; // row 9 => 1, row 0 => 10
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
  function getSideForCapture() {
    try {
      if (typeof ctx?.getTurn === "function") return ctx.getTurn();
      if (typeof ctx?.turn === "string") return ctx.turn;
      if (typeof container?.turn === "string") return container.turn;
    } catch {}
    return null;
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

        // casilla que se vacía -> from candidate
        if (b != null && a == null) froms.push([r, c]);

        // casilla que se llena -> to candidate
        if (b == null && a != null) tos.push([r, c]);

        // caso coronación / reemplazo: misma casilla cambia de 'r' a 'R'
        // lo tratamos como "to" si antes estaba algo y después algo (pero no null)
        if (b != null && a != null) {
          tos.push([r, c]);
        }
      }
    }

    // Heurística: necesitamos al menos 1 from y 1 to
    if (froms.length < 1 || tos.length < 1) return null;

    // Elegimos el último "to" por si hubo reemplazos (corona) o múltiples cambios
    const from = froms[0];
    const to = tos[tos.length - 1];

    return { from, to, froms, tos };
  }

  function captureExperienceFromFromTo(from, to, kind = "move") {
    if (!isAICapturing()) return;

    const moveAlg = moveFromToToAlg(from, to);
    if (!moveAlg) {
      console.log("[AI-CAPTURE DEBUG] no se pudo construir moveAlg desde from/to", { from, to });
      return;
    }

    const fen = getBoardForCapture();
    const side = getSideForCapture();

    console.log("[AI-CAPTURE DEBUG] moveAlg (diff):", moveAlg, "side:", side);

    try {
      recordAIMove({
        fen,
        side,
        move: moveAlg,
        tag: "editor_move",
        meta: {
          source: "Training/editor/interactions.js",
          kind,
          via: "board-diff",
        },
      });
    } catch (e) {
      console.warn("[AI-CAPTURE] recordAIMove falló:", e);
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
  // ✅ WRAP onClick: aquí hacemos board-diff
  // ————————————————————————————————————————————————
  const originalOnClick = ctrl.onClick?.bind(ctrl);

  async function onClickWrapped(ev) {
    const before = cloneBoard10(getBoardForCapture());
    let result;

    try {
      result = originalOnClick ? originalOnClick(ev) : undefined;
      if (result instanceof Promise) result = await result;
    } catch (err) {
      fireInvalid();
      throw err;
    }

    // Espera micro-tick para que el controller aplique el cambio al board
    await new Promise((r) => setTimeout(r, 0));

    const after = cloneBoard10(getBoardForCapture());

    const diff = inferFromToByDiff(before, after);

    if (!diff) {
      // Si no hubo cambio, probablemente fue click inválido o selección
      // (Esto también explica por qué el controller devuelve undefined)
      // No grabamos.
      // debug suave:
      // console.log("[DIFF] sin movimiento detectado");
      return result;
    }

    // Dispara sfx básicos (no sabemos si fue captura, pero al menos hubo movimiento)
    fireMove();

    // Si hubo más cambios de los normales, asumimos captura (heurística)
    const manyChanges = (diff.froms?.length || 0) + (diff.tos?.length || 0) >= 3;
    if (manyChanges) fireCapture();

    // ✅ Graba experiencia con from-to (ya no será null)
    captureExperienceFromFromTo(diff.from, diff.to, manyChanges ? "captureHop" : "move");

    return result;
  }

  boardEl.addEventListener("click", onClickWrapped);

  // ————————————————————————————————————————————————
  // CLEANUP
  // ————————————————————————————————————————————————
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
