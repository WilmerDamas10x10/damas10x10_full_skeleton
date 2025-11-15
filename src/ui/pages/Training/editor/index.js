// src/ui/pages/Training/editor/index.js
import { installGoldenHook } from "./dev/goldenHook.js";
import { onMove, onCaptureHop, onCrown, onInvalid } from "../../../sfx.hooks.js"; // (no-op imports OK)
import { setupVariantToggle } from "./ui/variantToggle.js"; // selector Variante
import "./editor.fx.css";
import "./editor.ipad.css"; 
import "./editor.responsive.css";
import "./ui/ipad.hotfix.js";



// Hints y pintado (UI básica)
export { clearHints, markOrigin, hintMove, showFirstStepOptions, showRouteFull, paintState } from "./hints.js";

// ✅ Stubs V1 centralizados: evitan overlays legacy
export { markRouteLabel, markStep } from "./config/legacy-noops.js";

// Plantilla e iconos
export { getEditorTemplate } from "./template.js";
export { applyButtonIcons } from "./icons.js";

// Estado base del editor
export { SIZE, dark, startBoard } from "./state.js";

// Dibujo del tablero
export { drawBoard } from "./draw.js";

// Lógica de movimientos del Editor (no confundir con @rules)
export { applySingleCapture, bestRoutesFromPos } from "./moves.js";

// Undo/Redo
export { makeUndoAPI } from "./undo.js";

// Toolbar (API nueva, sin dependencias circulares)
export { setupToolbar, syncToolButtons } from "./ui/toolbar.js";

// Controlador e interacciones (si conservas la API antigua)
export { makeController } from "./controller.js";
export { attachBoardInteractions } from "./interactions.js";

// Layout / dock de turno
export { centerBoardWithSidebar, mountTurnDockFixed } from "./layout.js";

/* ─────────────────────────────────────────────────────────────────────
   Helper: inicializa la toolbar, monta el toggle de variante
   y corrige el “hueco” forzando el PRIMER BOTÓN a ocupar la fila completa.
   ───────────────────────────────────────────────────────────────────── */
export async function initToolbarWithVariant(container, ctx) {
  // 1) Monta/obtén la toolbar
  let toolbarEl;
  try {
    toolbarEl = await awaitMaybe(setupToolbar, container, ctx);
  } catch {}
  if (!toolbarEl) {
    toolbarEl =
      container?.querySelector?.("#toolbar, .toolbar") ||
      document.querySelector("#toolbar, .toolbar") ||
      null;
  }
  if (!toolbarEl) return null;

  // 2) Selector de variante (clásica / internacional)
  setupVariantToggle(toolbarEl, ctx);

  // 3) Reacción defensiva al aplicar variante
  toolbarEl.addEventListener("variant:apply", () => {
    try { ctx?.rebuildHints?.(); } catch {}
    try { ctx?.repaint?.(); } catch {}
  });

  // 4) FIX anti-hueco:
  //    - Si el primer hijo NO es botón: lo trato como “intro” (span-2).
  //    - Si sí es botón: el PRIMER contenedor que tenga botón pasa a span-2.
  try {
    const isButtonish = (el) =>
      !!el?.querySelector?.("button, a[role='button'], a.button, .btn");

    const first = toolbarEl.firstElementChild;
    if (first && !isButtonish(first)) {
      first.classList.add("span-2", "toolbar-intro");
    }

    // Primer contenedor con botón real → span-2 (evita que arranque en columna 2)
    const firstBtnContainer = Array.from(toolbarEl.children).find(isButtonish);
    if (firstBtnContainer) {
      firstBtnContainer.classList.add("span-2");
      // normaliza por si traía grid-column inline
      firstBtnContainer.style.gridColumn = "1 / -1";
    }

    // Normalización básica del resto (evita spans accidentales)
    Array.from(toolbarEl.children).forEach((el) => {
      if (el !== firstBtnContainer && !el.classList.contains("toolbar-intro")) {
        el.style.gridColumn = "auto / span 1";
        el.style.float = "none";
        el.style.position = "static";
        el.style.margin = "0";
        el.style.width = "100%";
      }
    });
  } catch {}

  return toolbarEl;
}

// Pequeño helper para tolerar setupToolbar async/sync indistintamente
async function awaitMaybe(fn, ...args) {
  if (typeof fn !== "function") return undefined;
  const out = fn(...args);
  return out instanceof Promise ? await out : out;
}

/* ─────────────────────────────────────────────────────────────────────
   Auto-enhance: si la página no llama explícitamente initToolbarWithVariant,
   lo intentamos al cargar el DOM (no rompe si ya se montó).
   ───────────────────────────────────────────────────────────────────── */
(function autoEnhanceToolbar() {
  const run = async () => {
    const container =
      document.querySelector(".editor, #editor, [data-editor-root], [data-editor]") ||
      document.body;

    const ctx = { repaint: () => {}, rebuildHints: () => {} };
    try { await initToolbarWithVariant(container, ctx); } catch {}
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(run, 0);
  } else {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  }
})();

/* ─────────────────────────────────────────────────────────────────────
   Reubicación responsiva de la toolbar:
   - En ≤768px (móvil/tablet): toolbar arriba del tablero.
   - En >768px (PC/TV): toolbar vuelve a su posición normal (a la derecha/abajo).
   No toca reglas; solo reordena nodos. Tolerante a montajes tardíos.
   ───────────────────────────────────────────────────────────────────── */
(function mountResponsiveToolbarPlacement() {
  const MM = window.matchMedia("(max-width: 768px)");
  let lastMobile = null;

  function q(sel) { return document.querySelector(sel); }

  function getNodes() {
    const row = q(".board-row, .editor-layout") || document.body;
    const board = q("#board");
    // Preferimos un contenedor específico de toolbar si existe
    let toolbar = q("#right-toolbar") || q("#toolbar") || q(".toolbar");
    // Si setupToolbar devuelve un wrapper interior, lo usamos
    if (!toolbar) {
      toolbar = row.querySelector("[data-role='toolbar'], .editor-toolbar, .ed-toolbar") || null;
    }
    return { row, board, toolbar };
  }

  function place(isMobile) {
    const { row, board, toolbar } = getNodes();
    if (!row || !board || !toolbar) return;

    // Evitar bucles: si ya está en el lugar correcto, no hacemos nada
    const toolbarBeforeBoard = toolbar.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING ? false : true;

    if (isMobile) {
      // Toolbar debe ir ARRIBA del tablero dentro del mismo contenedor
      if (!(toolbarBeforeBoard && toolbar.parentElement === row)) {
        try {
          row.insertBefore(toolbar, board);
        } catch {}
      }
      toolbar.dataset.placement = "mobile-top";
    } else {
      // En desktop: colocamos la toolbar después del tablero (o al final del row)
      // para que el CSS la posicione a la derecha/abajo según tu grid.
      const afterBoard = board.nextElementSibling;
      const toolbarIsNext = afterBoard === toolbar;
      if (!toolbarIsNext || toolbar.parentElement !== row) {
        try {
          // Si existe un holder dedicado (#right-toolbar), lo usamos como contenedor.
          const holder = q("#right-toolbar");
          if (holder && holder !== toolbar) {
            holder.appendChild(toolbar);
          } else {
            // fallback: ponerla después del board
            if (board.nextSibling) {
              row.insertBefore(toolbar, board.nextSibling);
            } else {
              row.appendChild(toolbar);
            }
          }
        } catch {}
      }
      delete toolbar.dataset.placement;
    }
  }

  function apply() {
    const isMobile = MM.matches;
    if (lastMobile === isMobile) return;
    lastMobile = isMobile;
    place(isMobile);
  }

  // Primera aplicación
  apply();

  // Escucha de cambios de viewport
  MM.addEventListener ? MM.addEventListener("change", apply) : MM.addListener(apply);

  // Observer por si la toolbar/board se montan tarde o se re-renderizan
  const obs = new MutationObserver(() => apply());
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();

/* ─────────────────────────────────────────────────────────────────────
   GOLDEN solo si lo pides: en DEV y con ?golden=1
   ───────────────────────────────────────────────────────────────────── */
const ENABLE_GOLDEN =
  import.meta.env.DEV &&
  new URLSearchParams(location.search).get("golden") === "1";

if (ENABLE_GOLDEN) {
  try { installGoldenHook(document.body); } catch {}
} else {
  // Limpieza defensiva: si algún script lo inyectó, elimínalo
  const killGolden = () =>
    document.querySelectorAll("#golden-hook, .golden-hook, .golden-fab")
      .forEach(n => n.remove());
  killGolden();
  document.addEventListener("DOMContentLoaded", killGolden, { once: true });
}

// ──────────────────────────────────────────────────────────────
/* Remover "Importar" y "Compartir" con observer (tolerante a timing) */
// ──────────────────────────────────────────────────────────────
(function removeImportAndShareButtonsRobust() {
  const TEXT_PATTERNS = [
    /import(ar|ación|ar fen|ar\s+fen)?/i,   // "Importar", "Importar FEN"
    /\bshare\b/i,                           // "Share"
    /compart(ir|ir fen|ir\s+fen|ir enlace)/i,
    /copiar\s+(enlace|link|url)/i,          // por si la acción está titulada así
  ];

  const SELECTORS = [
    // IDs/roles comunes
    '#btnImportar', '#btn-importar', '#importar',
    '#btnCompartir', '#btn-compartir', '#compartir',
    // botones/enlaces con data-attrs o roles
    'button[data-role="import"]',  'button[data-action="import"]',
    'button[data-role="share"]',   'button[data-action="share"]',
    '[aria-label*="Import" i]',    '[aria-label*="Importar" i]',
    '[aria-label*="Share" i]',     '[aria-label*="Compart" i]',
    'a[role="button"]', 'a.button', 'button', '.btn'
  ];

  const TOOLBAR_ROOTS = [
    '#toolbar', '.toolbar', '#right-toolbar',
    '.editor-toolbar', '.ed-toolbar', '.board-row'
  ];

  // Coincidencia por texto visible dentro del nodo
  function matchesText(node) {
    const text = (node.textContent || '').trim();
    if (!text) return false;
    return TEXT_PATTERNS.some(rx => rx.test(text));
  }

  // ¿Este nodo representa el botón objetivo?
  function isTargetNode(node) {
    if (!(node instanceof HTMLElement)) return false;
    // Si coincide selector directo
    if (node.matches) {
      // ID exacto de los que conocemos
      if (['btnImportar','btn-importar','importar','btnCompartir','btn-compartir','compartir'].includes(node.id)) {
        return true;
      }
      // aria/title
      const aria = (node.getAttribute('aria-label') || '');
      const title = (node.getAttribute('title') || '');
      if (TEXT_PATTERNS.some(rx => rx.test(aria)) || TEXT_PATTERNS.some(rx => rx.test(title))) {
        return true;
      }
    }
    // Si es button/anchor/btn y su texto contiene las palabras clave
    if (node.matches?.('button, a[role="button"], a.button, .btn')) {
      if (matchesText(node)) return true;
      // A veces el texto está en un span interno
      const inner = node.querySelector('span, strong, .label, .text');
      if (inner && matchesText(inner)) return true;
    }
    return false;
  }

  function removeTargets(root = document) {
    let removed = 0;

    // 1) Selectores conocidos
    root.querySelectorAll(SELECTORS.join(',')).forEach(el => {
      if (isTargetNode(el)) {
        el.remove();
        removed++;
      }
    });

    // 2) Barrido defensivo por botones/enlaces “genéricos”
    root.querySelectorAll('button, a[role="button"], a.button, .btn').forEach(el => {
      if (isTargetNode(el)) {
        el.remove();
        removed++;
      }
    });

    // 3) Limpieza de separadores huérfanos
    root.querySelectorAll('.divider, .toolbar-divider').forEach(div => {
      if (!div.previousElementSibling || !div.nextElementSibling) div.remove();
    });

    return removed;
  }

  // Intento inmediato
  removeTargets(document);

  // Observer: vigila toolbars y el body por si montan tarde o re-renderizan
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList' && (m.addedNodes?.length || m.removedNodes?.length)) {
        const scope = (m.target instanceof HTMLElement) ? m.target : document;
        removeTargets(scope);
      }
      if (m.type === 'attributes') {
        const el = m.target;
        if (isTargetNode(el)) {
          el.remove();
        }
      }
    }
  });

  // Observar el body y, si existen, las raíces de toolbar
  const observeTargets = new Set([document.body]);
  TOOLBAR_ROOTS.forEach(sel => {
    const n = document.querySelector(sel);
    if (n) observeTargets.add(n);
  });

  observeTargets.forEach(n => {
    observer.observe(n, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title', 'class']
    });
  });

  // Safety net: reintentos temporizados por si algo monta muy tarde
  let retries = 6;
  const tick = () => {
    removeTargets(document);
    if (--retries > 0) setTimeout(tick, 250);
  };
  setTimeout(tick, 0);
})();

// Fallback de montaje de grid: se ejecuta siempre que entras al Editor
window.addEventListener('load', () => {
  try {
    const board = document.querySelector('#board');
    const bar   = document.querySelector('#tools') || document.querySelector('#toolbar');
    if (!board || !bar) return; // no estamos en el Editor

    // Crea #board-row si falta
    let row = document.querySelector('#board-row');
    if (!row) {
      row = document.createElement('div');
      row.id = 'board-row';
      row.className = 'board-row';
      board.parentElement.insertBefore(row, board);
      row.appendChild(board);
    }

    // Crea #right-panel si falta y mete la barra
    let right = document.querySelector('#right-panel');
    if (!right) {
      right = document.createElement('aside');
      right.id = 'right-panel';
      right.className = 'right-panel sidebar';
      row.appendChild(right);
    }
    if (bar.parentElement !== right) right.appendChild(bar);

    // Hotfix iPad: inyecta (idempotente)
    if (!document.getElementById('editor-ipad-hotfix')) {
      const s = document.createElement('style');
      s.id = 'editor-ipad-hotfix';
      s.textContent = `
@media (min-width:900px) and (max-width:1199.98px){
  #board-row{ display:grid !important; grid-template-columns:minmax(560px,1fr) 340px !important; gap:16px !important; align-items:start !important; justify-content:center !important; }
  #right-panel{ grid-column:2/3 !important; position:static !important; max-width:340px !important; z-index:2 !important; max-height:calc(100dvh - 140px) !important; overflow:auto !important; }
  #right-panel #tools, #right-panel #toolbar{ display:grid !important; grid-template-columns:1fr !important; grid-auto-rows:50px !important; gap:10px !important; }
}
@media (max-width:1199.98px){ html,body{ overflow-y:auto !important; } }`;
      (document.head || document.documentElement).appendChild(s);
    }
  } catch (e) {
    console.warn('[editor grid fallback] aviso:', e);
  }
});
