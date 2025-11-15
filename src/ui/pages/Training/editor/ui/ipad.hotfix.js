// src/ui/pages/Training/editor/ui/ipad.hotfix.js
// Hotfix Editor (iPad Pro 1024×1366 y 900–1199px)
// - Espera a #board y #tools/#toolbar (SPA).
// - Crea #board-row / #right-panel si faltan.
// - Mueve turno/WAN (#left-dock / #turn-dock ...) dentro del grid.
// - Limpia height/overflow "tóxicos" en html/body/#app/#root/.design-scope/[data-editor-root]/#editor-host.
// - Inyecta CSS idempotente.

(function () {
  const FLAG = "__IPAD_HOTFIX__";
  if (!window[FLAG]) window[FLAG] = { runs: 0, last: null, applied: false };

  const log = (...a) => { try { console.log("[ipad.hotfix]", ...a); } catch {} };

  function injectCSS() {
    if (document.getElementById("editor-ipad-hotfix")) return;
    const css = `
@media (min-width:900px) and (max-width:1199.98px){
  html,body{ overflow-y:auto !important; overflow-x:hidden !important; min-height:auto !important; height:auto !important; }
  #app,#root,.design-scope,[data-editor-root]{ overflow:visible !important; overflow-y:auto !important; min-height:auto !important; height:auto !important; }

  #board-row{
    display:grid !important;
    grid-template-columns:minmax(560px,1fr) 340px !important;
    column-gap:16px !important;
    align-items:start !important;
    justify-content:center !important;
    width:100% !important;
    margin:12px auto 0 auto !important;
  }
  #board{
    grid-column:1/2 !important;
    max-width:calc(100vw - 340px - 16px - 24px) !important;
    width:min(820px,100%) !important;
    justify-self:center !important;
    position:relative !important;
    z-index:1 !important;
  }
  #board.board-fluid{ aspect-ratio:1/1 !important; height:auto !important; }
  #board .board-canvas-fluid{ width:100% !important; height:100% !important; display:block !important; }

  #right-panel{
    grid-column:2/3 !important;
    position:static !important; top:auto !important; float:none !important;
    width:100% !important; max-width:340px !important; z-index:2 !important;
    max-height:calc(100dvh - 220px) !important; overflow:auto !important;
  }
  #right-panel #tools, #right-panel #toolbar{
    display:grid !important; grid-template-columns:1fr !important;
    grid-auto-rows:50px !important; gap:10px !important;
  }
  #right-panel #tools > *, #right-panel #toolbar > *{
    width:100% !important; height:50px !important; min-height:50px !important;
    display:inline-flex !important; align-items:center !important; justify-content:flex-start !important;
    gap:8px !important; padding:10px 14px !important; box-sizing:border-box !important;
    white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important;
  }
  .__leftDockInGrid{
    grid-column:1 / -1 !important;
    margin-bottom:12px !important;
    position:static !important; top:auto !important;
  }
}
@media (max-width:1199.98px){ html,body{ overflow-y:auto !important; } }
`;
    const s = document.createElement("style");
    s.id = "editor-ipad-hotfix";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
    log("CSS inyectado");
  }

  // 🔧 Limpieza agresiva de ancestros (incluye #editor-host y fuerza auto aunque venga en px)
  function relaxAncestors() {
    const nodes = [
      document.documentElement,
      document.body,
      document.querySelector('.design-scope'),
      document.getElementById('app'),
      document.getElementById('root'),
      document.querySelector('[data-editor-root]'),
      document.getElementById('editor-host') // <- importante
    ].filter(Boolean);

    const force = (el) => {
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('min-height', 'auto', 'important');
      el.style.setProperty('overflow', 'visible', 'important');
      el.style.setProperty('overflow-y', 'auto', 'important');
      el.style.setProperty('overflow-x', 'hidden', 'important');
    };

    nodes.forEach(force);
  }

  function findLeftDock(root) {
    const direct =
      root.querySelector("#left-dock") ||
      root.querySelector(".left-dock") ||
      root.querySelector(".dock-turno") ||
      root.querySelector("#turn-dock")?.parentElement ||
      null;
    if (direct) return direct;

    const turnStatus = root.querySelector("#turn-status");
    if (turnStatus && turnStatus.closest("div")) return turnStatus.closest("div");

    const switchBtn = Array.from(root.querySelectorAll("button"))
      .find(b => /cambiar\s*turno/i.test(b.textContent || ""));
    if (switchBtn && switchBtn.closest("div")) {
      const cand = switchBtn.closest("div");
      return cand.parentElement?.closest("div") || cand;
    }

    const blocks = Array.from(root.querySelectorAll("div,section,aside"))
      .filter(n => (n.textContent || "").toLowerCase().includes("turno"))
      .sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return blocks[0] || null;
  }

  function forceGridPlacement(row, leftDock, board, right) {
    if (leftDock) {
      if (leftDock.parentElement !== row) row.insertBefore(leftDock, row.firstChild);
      leftDock.classList.add("__leftDockInGrid");
      leftDock.style.gridColumn = "1 / -1";
    }
    if (board && board.parentElement !== row) row.appendChild(board);
    if (right && right.parentElement !== row) row.appendChild(right);
  }

  function tryRescueOnce() {
    window[FLAG].runs++;
    const board = document.querySelector("#board");
    const bar = document.querySelector("#tools") || document.querySelector("#toolbar");
    if (!board || !bar) { log("Aún no es la vista del Editor (faltan #board o #tools/#toolbar)."); return false; }

    // 0) primero relajamos contenedores tóxicos (altura/overflow)
    relaxAncestors();

    // 1) contenedor grid
    let row = document.querySelector("#board-row") || document.querySelector(".board-row");
    if (!row) {
      row = document.createElement("div");
      row.id = "board-row";
      row.className = "board-row";
      board.parentElement.insertBefore(row, board);
      row.appendChild(board);
      log("Creado #board-row y movido #board dentro.");
    } else {
      row.classList.add("board-row");
    }

    // 2) panel derecho
    let right = document.querySelector("#right-panel");
    if (!right) {
      right = document.createElement("aside");
      right.id = "right-panel";
      right.className = "right-panel sidebar";
      row.appendChild(right);
      log("Creado #right-panel.");
    }

    // 3) meter barra en panel derecho
    if (bar.parentElement !== right) {
      right.appendChild(bar);
      log("Movido toolbar dentro de #right-panel (", bar.id || "sin-id", ").");
    }

    // 4) turno/WAN al grid
    const leftDock = findLeftDock(document.body);
    if (leftDock) {
      forceGridPlacement(row, leftDock, board, right);
      log("Movido panel Turno/WAN dentro del grid.");
    } else {
      log("No encontré panel Turno/WAN.");
    }

    // 5) CSS
    injectCSS();

    window[FLAG].applied = true;
    window[FLAG].last = {
      row: !!row, right: !!right, board: !!board, tools: !!bar,
      leftDock: !!leftDock, display: getComputedStyle(row).display
    };
    log("Aplicado. Estado:", window[FLAG].last);
    return true;
  }

  function setupObservers() {
    if (tryRescueOnce()) return;

    let retries = 0;
    const maxRetries = 25;
    const interval = setInterval(() => {
      if (tryRescueOnce()) { clearInterval(interval); return; }
      if (++retries >= maxRetries) clearInterval(interval);
    }, 120);

    const mo = new MutationObserver(() => {
      if (!window[FLAG].applied) {
        if (tryRescueOnce()) mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("hashchange", () => { window[FLAG].applied = false; setTimeout(tryRescueOnce, 0); });
    window.addEventListener("popstate", () => { window[FLAG].applied = false; setTimeout(tryRescueOnce, 0); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupObservers, { once: true });
  } else {
    setupObservers();
  }
})();
