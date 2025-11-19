// src/ui/pages/Training/editor/ui/turn.js
// Actualiza SOLO el UI de turno dentro del Editor. Nunca toca <body> ni otras páginas.

import { COLOR } from "@rules";

const labelOf = (t) => (t === COLOR.ROJO ? "BLANCAS" : "NEGRAS");

// Encuentra de forma segura el root del Editor
function getEditorRoot(from) {
  // Raíz válida SOLO si tiene data-page="editor"
  const r =
    (from && (from.closest?.('[data-page="editor"]') || null)) ||
    document.querySelector('[data-page="editor"]');
  return r || null;
}

export function updateTurnUI(container, turn) {
  const root = getEditorRoot(container);
  if (!root) return; // ← fuera del Editor: no hacer nada

  const label = labelOf(turn);

  // Marca el root del editor (no el body)
  try {
    root.setAttribute("data-turn", turn === COLOR.ROJO ? "white" : "black");
    root.classList.add("turn-kick");
    setTimeout(() => root.classList.remove("turn-kick"), 300);
  } catch {}

  // Compat opcional si existen estos nodos (y SOLO dentro del editor)
  try {
    const tInline = root.querySelector("#turn");
    if (tInline) tInline.textContent = label;

    const badge = root.querySelector("#turno-actual");
    if (badge) {
      badge.textContent = label;
      badge.classList.toggle("is-rojo",  turn === COLOR.ROJO);
      badge.classList.toggle("is-negro", turn === COLOR.NEGRO);
    }
  } catch {}
}
