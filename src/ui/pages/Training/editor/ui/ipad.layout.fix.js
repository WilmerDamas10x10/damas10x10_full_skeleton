// ================================
// iPad layout fix — tablero pegado + toolbar + controles arriba en 2 columnas
// Solo para iPad / tablets táctiles (no escritorio).
// ================================
(function () {
  "use strict";

  // Solo aplicar este fix en dispositivos tipo iPad / táctiles.
  // En escritorio (mouse + teclado) NO tocamos el layout para evitar desajustes al hacer zoom.
  let IS_IPAD_LIKE = false;
  try {
    const ua = navigator.userAgent || "";
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isTouch =
      (window.matchMedia && matchMedia("(pointer: coarse)").matches) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
    IS_IPAD_LIKE = isIOS && isTouch;
  } catch (e) {
    IS_IPAD_LIKE = false;
  }

  if (!IS_IPAD_LIKE) {
    // En escritorio no hacemos nada para no romper el zoom.
    return;
  }

  const MQ = window.matchMedia(
    "(min-width: 900px) and (max-width: 1199.98px)"
  );
  const $ = (s, r = document) => r.querySelector(s);

  function hosts() {
    const row =
      $("#board-row") ||
      $(".board-row") ||
      $(".editor-layout") ||
      document.body;
    const board = $("#board");
    const toolbar =
      $("#right-panel") ||
      $(".right-panel") ||
      $(".editor-layout > [data-role='toolbar']") ||
      $(".editor-layout > .editor-toolbar") ||
      $(".editor-layout > .ed-toolbar") ||
      $("#tools") ||
      $("#toolbar");
    return { row, board, toolbar };
  }

  // Hijo del board absoluto SIN cambiar su display interno
  function normalizeBoardLayers() {
    const board = $("#board");
    if (!board) return;

    const host = board.parentElement;
    if (host && !host.hasAttribute("data-board-host")) {
      host.setAttribute("data-board-host", "1");
    }

    board.style.position = "relative";
    board.style.margin = "0 auto";
    board.style.maxWidth = "100%";
    board.style.maxHeight = "100%";
  }

  // No-op “seguro”: recentrar tablero si hace falta
  function snapBoard() {
    const board = $("#board");
    if (!board) return;
    try {
      board.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "auto",
      });
    } catch {
      // nada
    }
  }

  // Agrupa botones superiores por TEXTO (antes del panel WAN) en 2 columnas
  function arrangeTopControlsTwoCols() {
    const row =
      document.querySelector("#board-row") ||
      document.querySelector(".board-row") ||
      document.querySelector(".editor-layout") ||
      document.body;

    if (!row || row.__topControlsApplied) return;

    // 1) Detectar panel WAN (div que contiene texto "WAN" o botón "Conectar")
    const wan = Array.from(row.querySelectorAll("*")).find((el) => {
      const txt = (el.textContent || "").toLowerCase();
      const hasConnect = !!el.querySelector(
        "button, input[type='button'], input[type='submit']"
      );
      return (
        (txt.includes("wan") ||
          txt.includes("server") ||
          txt.includes("servidor")) &&
        hasConnect
      );
    });
    if (!wan) return;

    // 2) Buscar candidatos por texto (independiente del contenedor actual)
    const wanted =
      /(cambiar turno|guardar posición|cargar posición|importar|compartir)/i;
    const candidates = Array.from(
      row.querySelectorAll(
        "button, a.btn, .btn, input[type='button'], input[type='submit']"
      )
    ).filter((el) => wanted.test((el.textContent || el.value || "").trim()));

    if (!candidates.length) return;

    // 3) Crear el grid y colocarlo justo ANTES del panel WAN
    const grid = document.createElement("div");
    grid.className = "top-controls-grid";
    grid.setAttribute("data-made-by", "ipad-fix");
    wan.parentElement.insertBefore(grid, wan);

    // 4) Mover los botones al grid manteniendo el orden visual (por posición Y)
    candidates
      .map((el) => ({ el, top: el.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)
      .forEach(({ el }) => grid.appendChild(el));

    row.__topControlsApplied = true;
  }

  function normalizeRow(row) {
    if (!row) return;
    Object.assign(row.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start",
      gap: "0",
      padding: "0",
    });
  }

  function placeToolbar() {
    const { row, board, toolbar } = hosts();
    if (!row || !board || !toolbar) return false;

    if (toolbar.parentElement !== row) row.appendChild(toolbar);
    if (board.nextSibling !== toolbar) {
      row.insertBefore(toolbar, board.nextSibling);
    }

    normalizeRow(row);
    normalizeBoardLayers();
    snapBoard();

    arrangeTopControlsTwoCols(); // ← botones en 2 columnas sobre el WAN

    return true;
  }

  function apply() {
    if (!MQ.matches) return;
    placeToolbar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }

  (MQ.addEventListener
    ? MQ.addEventListener("change", apply)
    : MQ.addListener(apply));

  const mo = new MutationObserver(apply);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("resize", apply, { passive: true });
  window.addEventListener("orientationchange", apply, { passive: true });
})();
