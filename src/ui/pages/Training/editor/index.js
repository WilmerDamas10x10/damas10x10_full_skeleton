// src/ui/pages/Training/editor/index.js
import { installGoldenHook } from "./dev/goldenHook.js";
import { onMove, onCaptureHop, onCrown, onInvalid } from "../../../sfx.hooks.js";
import { setupVariantToggle } from "./ui/variantToggle.js";

// ✅ Orden correcto: base → responsive → iPad → botones → layout
import "./editor.fx.css";
import "./editor.responsive.css";
import "./editor.ipad.css";
// import "./ui/ipad.hotfix.js"; // (dejado fuera si ya no lo necesitas)
import "./buttons.css";
import "./ui/ipad.layout.fix.js";

// ► SOLO este: halo en piezas (sin tinte/badge)
import "./turn.halo.js";

// ──────────────────────────────────────────────────────────────
// Exportaciones existentes
export { clearHints, markOrigin, hintMove, showFirstStepOptions, showRouteFull, paintState } from "./hints.js";
export { markRouteLabel, markStep } from "./config/legacy-noops.js";
export { getEditorTemplate } from "./template.js";
export { applyButtonIcons } from "./icons.js";
export { SIZE, dark, startBoard } from "./state.js";
export { drawBoard } from "./draw.js";
export { applySingleCapture, bestRoutesFromPos } from "./moves.js";
export { makeUndoAPI } from "./undo.js";
export { setupToolbar, syncToolButtons } from "./ui/toolbar.js";
export { makeController } from "./controller.js";
export { attachBoardInteractions } from "./interactions.js";
export { centerBoardWithSidebar, mountTurnDockFixed } from "./layout.js";

// ✅ NUEVO: Re-export del cliente de IA (evita usar fetch("/ai/move") que da 404)
export { pedirJugadaIA, enviarLogIA } from "../../../api/ia.api.js";

// ──────────────────────────────────────────────────────────────
// GOLDEN (igual que antes)
const ENABLE_GOLDEN =
  import.meta.env?.DEV &&
  new URLSearchParams(location.search).get("golden") === "1";

if (ENABLE_GOLDEN) {
  try { installGoldenHook(document.body); } catch {}
} else {
  const killGolden = () =>
    document.querySelectorAll("#golden-hook, .golden-hook, .golden-fab")
      .forEach(n => n.remove());
  killGolden();
  document.addEventListener("DOMContentLoaded", killGolden, { once: true });
}
