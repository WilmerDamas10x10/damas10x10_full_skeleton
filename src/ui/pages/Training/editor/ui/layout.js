// src/ui/pages/Training/editor/ui/layout.js
// Estructura y montaje del layout del Editor (modo Entrenamiento)

import { installEditorWANPanel } from "./panels/wan.panel.js";

/* ---------------- Utils ---------------- */
function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

/* Inyecta un <style> con máxima precedencia para tablets (900–1199px)
   Compatible con #tools y con #toolbar (legacy) dentro de #right-panel */
function injectIpadHotfixCSS() {
  try {
    const id = "editor-ipad-hotfix";
    const prev = document.getElementById(id);
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

    const css = `
@media (min-width:900px) and (max-width:1199.98px){
  /* Grid de 2 columnas fijo: [ TABLERO | TOOLBAR ] */
  #board-row.board-row{
    display:grid !important;
    grid-template-columns:minmax(560px,1fr) 340px !important;
    gap:16px !important;
    align-items:start !important;
    justify-content:center !important;
    width:100% !important;
    margin:0 auto !important;
  }

  /* Tablero en col 1 y limitado para no tapar la barra */
  #board-row #board{
    grid-column:1/2 !important;
    max-width:calc(100vw - 340px - 16px - 24px) !important;
    width:min(820px,100%) !important;
    justify-self:center !important;
    position:relative !important;
    z-index:1 !important;
  }
  #board-row #board.board-fluid{ aspect-ratio:1/1 !important; height:auto !important; }
  #board-row #board .board-canvas-fluid{ width:100% !important; height:100% !important; display:block !important; }

  /* Toolbar real en col 2 (soporta #tools y #toolbar legacy) */
  #board-row #right-panel{
    grid-column:2/3 !important;
    position:static !important;
    top:auto !important;
    float:none !important;
    width:100% !important;
    max-width:340px !important;
    z-index:2 !important;
    max-height:calc(100dvh - 140px) !important;  /* evita que crezca infinito */
    overflow:auto !important;                     /* scroll interno */
  }

  /* Contenido de la barra como grilla vertical 1 columna */
  #right-panel #tools,
  #right-panel #toolbar{
    display:grid !important;
    grid-template-columns:1fr !important;
    grid-auto-rows:50px !important;
    gap:10px !important;
    align-items:stretch !important;
    justify-items:stretch !important;
  }

  #right-panel #tools > *,
  #right-panel #toolbar > *{
    width:100% !important;
    min-height:50px !important;
    height:50px !important;
    display:inline-flex !important;
    align-items:center !important;
    justify-content:flex-start !important;
    gap:8px !important;
    padding:10px 14px !important;
    box-sizing:border-box !important;
    white-space:nowrap !important;
    overflow:hidden !important;
    text-overflow:ellipsis !important;
  }

  /* Panel izquierdo a toda la fila, debajo */
  #left-dock, #turn-dock, .dock-turno, .wan-panel, .wan-card{
    grid-column:1 / -1 !important;
    position:static !important;
    top:auto !important;
    margin-bottom:12px !important;
  }

  /* Cortes de posibles sticky que superponen */
  #right-panel [class*="sticky"],
  #board-row [style*="position: sticky"]{
    position:static !important; top:auto !important;
  }
}
/* Por si algún estilo global corta el scroll en tablets */
@media (max-width:1199.98px){
  html, body { overflow-y: auto !important; }
}
`;
    const style = document.createElement("style");
    style.id = id;
    style.type = "text/css";
    style.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {
    console.warn("[layout.injectIpadHotfixCSS] aviso:", e);
  }
}

/* ------------------------------------------------------------------
 * setupResponsive: limpia el legacy y asegura grid + hotfix iPad.
 * ------------------------------------------------------------------ */
export function setupResponsive(root) {
  try {
    const old = document.getElementById("css-board-responsive");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    const row = (root && root.querySelector("#board-row")) || document.getElementById("board-row");
    if (row) {
      row.classList.add("board-row");
      row.style.display = "";
      row.style.flexWrap = "";
      row.style.position = "";
      row.style.gap = "";
    }

    injectIpadHotfixCSS();
  } catch (e) {
    console.warn("[layout.setupResponsive] aviso:", e);
  }
}

/* ---------------- Layout principal ---------------- */
export function createEditorLayout(root, editorApi) {
  if (!root) throw new Error("Root no definido para createEditorLayout");

  // Evitar múltiples montajes
  let row = root.querySelector("#board-row");
  if (!row) {
    row = el(`<div id="board-row" class="board-row"></div>`);
    root.appendChild(row);
  } else {
    row.classList.add("board-row");
  }

  // Panel izquierdo (turno + guardar/cargar/importar/compartir)
  let leftDock = row.querySelector("#left-dock");
  if (!leftDock) {
    leftDock = el(`
      <div id="left-dock" class="left-dock">
        <div id="turn-dock">
          <h4 style="margin:0;">Turno</h4>
          <div id="turn-status" class="turn-status">BLANCO</div>
          <button id="btn-switch-turn" type="button">Cambiar turno</button>
        </div>

        <div id="group-save-load-local" style="margin-top:1rem;">
          <button id="btn-save" type="button">Guardar posición</button>
          <button id="btn-load" type="button">Cargar posición</button>

          <div class="dropdown">
            <button class="dropbtn" type="button">Importar ▼</button>
            <div class="dropdown-content">
              <button id="import-fen" type="button">Pegar FEN</button>
              <button id="import-base64" type="button">Pegar Base64</button>
              <button id="import-jaxon" type="button">Cargar JAXON</button>
            </div>
          </div>

          <div class="dropdown">
            <button class="dropbtn" type="button">Compartir ▼</button>
            <div class="dropdown-content">
              <button id="share-fen" type="button">Copiar FEN</button>
              <button id="share-link" type="button">Copiar enlace</button>
            </div>
          </div>
        </div>
      </div>
    `);
    row.appendChild(leftDock);
  }

  // Tablero
  let board = row.querySelector("#board");
  if (!board) {
    board = el(`
      <div id="board" class="board-fluid">
        <canvas class="board-canvas-fluid"></canvas>
      </div>
    `);
    row.appendChild(board);
  }

  // Panel derecho (sidebar)
  let rightPanel = row.querySelector("#right-panel");
  if (!rightPanel) {
    rightPanel = el(`
      <aside id="right-panel" class="right-panel sidebar" aria-label="Herramientas del editor"></aside>
    `);
    row.appendChild(rightPanel);
  } else {
    rightPanel.classList.add("sidebar");
  }

  // ── Toolbar: reutilizar #toolbar si ya existe en el DOM ─────────────
  let legacyToolbar = root.querySelector("#toolbar") || rightPanel.querySelector("#toolbar");

  if (!legacyToolbar) {
    let tools = rightPanel.querySelector("#tools");
    if (!tools) {
      tools = el(`
        <div id="tools">
          <button id="btn-reset" type="button">Posición Inicial</button>
          <button id="btn-clear" type="button">Vaciar Tablero</button>

          <button id="add-white" type="button">Agregar</button>
          <button id="add-black" type="button">Agregar</button>
          <button id="add-white-queen" type="button">Agregar</button>
          <button id="add-black-queen" type="button">Agregar</button>

          <button id="btn-eraser" type="button">Borrador</button>
          <button id="btn-undo" type="button">Deshacer</button>
          <button id="btn-redo" type="button">Rehacer</button>
          <button id="btn-menu" type="button">Volver al menú</button>
          <button id="btn-sound" type="button">Sonido ON</button>
          <button id="btn-rotate" type="button">Girar tablero</button>

          <button id="btn-download-fen" type="button">Descargar .FEN</button>
          <button id="btn-copy-fen" type="button">Copiar FEN</button>
        </div>
      `);
      rightPanel.appendChild(tools);
    }
  } else {
    if (legacyToolbar.parentElement !== rightPanel) {
      legacyToolbar.parentElement.removeChild(legacyToolbar);
      rightPanel.appendChild(legacyToolbar);
    }
  }

  // Nota al pie (una sola vez)
  if (!rightPanel.querySelector(".wan-note")) {
    const note = el(`
      <small class="wan-note" style="opacity:.6;display:block;margin-top:.5rem;">
        La WAN solo conecta al compartir.
      </small>
    `);
    rightPanel.appendChild(note);
  }

  try {
    installEditorWANPanel(leftDock, { getBridge: editorApi?.getBridge });
  } catch (e) {
    console.warn("[layout.installEditorWANPanel] aviso:", e);
  }

  setupResponsive(root);

  return { row, board, leftDock, rightPanel };
}

/* ==========================================================
   RESCATE AUTOMÁTICO AL CARGAR:
   Si existen #board y #toolbar/#tools pero falta #board-row,
   creamos el grid y movemos la barra al #right-panel.
   ========================================================== */
function rescueIfMissing() {
  try {
    const root = document.querySelector("[data-editor-root]") || document.body;
    const board = document.querySelector("#board");
    const bar = document.querySelector("#tools") || document.querySelector("#toolbar");
    let row = document.querySelector("#board-row") || document.querySelector(".board-row");

    if (!board || !bar) return; // no estamos en el Editor aún

    if (!row) {
      row = el(`<div id="board-row" class="board-row"></div>`);
      const parent = board.parentElement || root;
      parent.insertBefore(row, board);
      row.appendChild(board);
    }

    let right = row.querySelector("#right-panel");
    if (!right) {
      right = el(`<aside id="right-panel" class="right-panel sidebar" aria-label="Herramientas del editor"></aside>`);
      row.appendChild(right);
    }
    if (bar.parentElement !== right) right.appendChild(bar);

    setupResponsive(root);
  } catch (e) {
    console.warn("[layout.rescueIfMissing] aviso:", e);
  }
}

// Auto-ejecuta el rescate cuando la vista del editor está lista
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", rescueIfMissing, { once: true });
} else {
  rescueIfMissing();
}

/* ==========================================================
   RESCATE AUTOMÁTICO AL CARGAR (permanente)
   - Si existen #board y #toolbar/#tools pero falta #board-row,
     crea el grid, el #right-panel y mueve la barra adentro.
   - Inyecta el hotfix iPad 1024×1366.
   ========================================================== */
function __editor_rescueGridOnce() {
  try {
    const board = document.querySelector('#board');
    const bar   = document.querySelector('#tools') || document.querySelector('#toolbar');
    if (!board || !bar) return; // no estamos en la vista del Editor

    // 1) Crea #board-row si falta
    let row = document.querySelector('#board-row');
    if (!row) {
      row = document.createElement('div');
      row.id = 'board-row';
      row.className = 'board-row';
      board.parentElement.insertBefore(row, board);
      row.appendChild(board);
    }

    // 2) Crea #right-panel si falta y mete la barra
    let right = document.querySelector('#right-panel');
    if (!right) {
      right = document.createElement('aside');
      right.id = 'right-panel';
      right.className = 'right-panel sidebar';
      row.appendChild(right);
    }
    if (bar.parentElement !== right) right.appendChild(bar);

    // 3) Hotfix iPad (idempotente: no duplica)
    if (!document.getElementById('editor-ipad-hotfix')) {
      const css = `
@media (min-width:900px) and (max-width:1199.98px){
  #board-row{ display:grid !important; grid-template-columns:minmax(560px,1fr) 340px !important; gap:16px !important; align-items:start !important; justify-content:center !important; }
  #board{ grid-column:1/2 !important; max-width:calc(100vw - 340px - 16px - 24px) !important; width:min(820px,100%) !important; justify-self:center !important; position:relative !important; z-index:1 !important; }
  #right-panel{ grid-column:2/3 !important; position:static !important; max-width:340px !important; z-index:2 !important; max-height:calc(100dvh - 140px) !important; overflow:auto !important; }
  #right-panel #tools, #right-panel #toolbar{ display:grid !important; grid-template-columns:1fr !important; grid-auto-rows:50px !important; gap:10px !important; }
}
@media (max-width:1199.98px){ html,body{ overflow-y:auto !important; } }`;
      const s = document.createElement('style');
      s.id = 'editor-ipad-hotfix';
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    }
  } catch (e) {
    console.warn('[editor grid fallback] aviso:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', __editor_rescueGridOnce, { once: true });
} else {
  __editor_rescueGridOnce();
}
