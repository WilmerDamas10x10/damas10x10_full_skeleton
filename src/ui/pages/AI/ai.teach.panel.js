// src/ui/pages/AI/ai.teach.panel.js
// Panel minimalista para feedback manual ("enseñar" = guardar jugada correcta).
// UX: SIN títulos ni tips. Solo: Lado IA + input de "Jugada correcta" + botón.

export function mountTeachPanel({ mountPoint, getState, onTeach }) {
  const wrap = document.createElement("div");
  wrap.className = "ai-teach-panel";

  wrap.innerHTML = `
    <div class="ai-teach-row">
      <span class="ai-teach-side" data-role="side">IA: —</span>
      <input
        class="ai-teach-input"
        data-role="input"
        placeholder="Jugada correcta (ej: e3-f4 o a3-c5-e7)"
        autocomplete="off"
        spellcheck="false"
      />
      <button class="ai-teach-btn" data-act="teach" disabled title="Guardar">💾</button>
      <span class="ai-teach-status" data-role="status"></span>
    </div>
  `;

  const btn = wrap.querySelector('[data-act="teach"]');
  const status = wrap.querySelector('[data-role="status"]');
  const sideEl = wrap.querySelector('[data-role="side"]');
  const input = wrap.querySelector('[data-role="input"]');

  function canTeach(p) {
    return (
      !!p &&
      Array.isArray(p.board) &&
      p.board.length === 10 &&
      (p.side === "R" || p.side === "N") &&
      typeof p.correct_move === "string" &&
      p.correct_move.trim().length > 0
    );
  }

  function refresh() {
    const st = getState?.() || {};
    const p = st.pending || null;

    // Side label
    const sideTxt = p?.side === "R" ? "ROJO" : p?.side === "N" ? "NEGRO" : "—";
    sideEl.textContent = `IA: ${sideTxt}`;

    // Input
    const hasPending = !!p;
    input.disabled = !hasPending;
    input.value = (p?.correct_move ?? "").toString();

    // Button
    btn.disabled = !canTeach(p);
  }

  // El usuario puede escribir manualmente la jugada correcta
  input.addEventListener("input", () => {
    const st = getState?.() || {};
    const p = st.pending || null;
    if (!p) return;
    p.correct_move = input.value;
    refresh();
  });

  btn.addEventListener("click", async () => {
    try {
      btn.disabled = true;
      status.textContent = "…";
      const st = getState?.() || {};
      const p = st.pending;

      await onTeach(p);

      status.textContent = "✅";
      setTimeout(() => (status.textContent = ""), 900);
    } catch (e) {
      status.textContent = "❌";
      setTimeout(() => (status.textContent = ""), 1500);
      console.error("[AI.TEACH] error:", e);
    } finally {
      refresh();
    }
  });

  mountPoint.appendChild(wrap);
  refresh();

  return { el: wrap, refresh };
}
