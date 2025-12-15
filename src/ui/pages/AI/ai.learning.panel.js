// src/ui/pages/AI/ai.learning.panel.js
// Panel UI para marcar resultados de partida y disparar entrenamiento
// Se monta de forma opcional desde index.js (modo IA).

export function mountLearningPanel(opts = {}) {
  const {
    toolbarEl,      // nodo donde se incrustra el panel (debajo)
    getFen,         // función que devuelve la posición actual (FEN o JSON)
    getRecordMove,  // función que devuelve recordMove (o null)
    getTrainModel,  // función que devuelve trainModel (o null)
  } = opts;

  if (!toolbarEl) return;

  // Evitar montar dos veces
  if (toolbarEl.__aiLearningMounted) return;
  toolbarEl.__aiLearningMounted = true;

  const panel = document.createElement("div");
  panel.className = "ai-learning-panel";
  panel.style.display = "flex";
  panel.style.flexWrap = "wrap";
  panel.style.gap = "6px";
  panel.style.justifyContent = "center";
  panel.style.alignItems = "center";
  panel.style.marginTop = "8px";
  panel.style.fontSize = "0.85rem";

  panel.innerHTML = `
    <span class="btn btn--subtle" style="cursor:default;">
      Aprendizaje IA (beta):
    </span>
    <button class="btn btn--subtle" id="btn-ai-learn-win">IA ganó</button>
    <button class="btn btn--subtle" id="btn-ai-learn-loss">IA perdió</button>
    <button class="btn btn--subtle" id="btn-ai-learn-draw">Partida interesante</button>
    <button class="btn btn--subtle" id="btn-ai-learn-stats">Ver resumen / entrenar</button>
  `;

  // Insertamos justo debajo del toolbar principal
  const parent = toolbarEl.parentNode;
  if (parent) {
    if (toolbarEl.nextSibling) {
      parent.insertBefore(panel, toolbarEl.nextSibling);
    } else {
      parent.appendChild(panel);
    }
  } else {
    // fallback: si por alguna razón no hay parent, lo dejamos al final del body
    document.body.appendChild(panel);
  }

  const $btnWin   = panel.querySelector("#btn-ai-learn-win");
  const $btnLoss  = panel.querySelector("#btn-ai-learn-loss");
  const $btnDraw  = panel.querySelector("#btn-ai-learn-draw");
  const $btnStats = panel.querySelector("#btn-ai-learn-stats");

  function safeRecord(score) {
    try {
      const fn = typeof getRecordMove === "function" ? getRecordMove() : null;
      if (typeof fn !== "function") {
        console.warn("[learning] recordMove no disponible todavía.");
        return;
      }
      const fen = typeof getFen === "function" ? (getFen() || "") : "";
      fn({
        fen,
        move: "__GAME_RESULT__",
        score,
      });
      console.info("[learning] Resultado registrado para entrenamiento:", score);
    } catch (e) {
      console.warn("[learning] Error registrando resultado:", e);
    }
  }

  function safeTrain() {
    try {
      const tm = typeof getTrainModel === "function" ? getTrainModel() : null;
      if (typeof tm !== "function") {
        console.warn("[learning] trainModel no disponible todavía.");
        return;
      }
      tm();
    } catch (e) {
      console.warn("[learning] Error ejecutando trainModel():", e);
    }
  }

  // ==== NUEVO: los tres botones de resultado también disparan entrenamiento ====

  $btnWin?.addEventListener("click", () => {
    console.log("[ai.learning.panel] IA ganó");
    safeRecord(+1);
    // Disparar envío de logs automáticamente
    setTimeout(() => {
      console.log("[ai.learning.panel] Entrenando IA tras 'IA ganó'");
      safeTrain();
    }, 300);
  });

  $btnLoss?.addEventListener("click", () => {
    console.log("[ai.learning.panel] IA perdió");
    safeRecord(-1);
    setTimeout(() => {
      console.log("[ai.learning.panel] Entrenando IA tras 'IA perdió'");
      safeTrain();
    }, 300);
  });

  $btnDraw?.addEventListener("click", () => {
    console.log("[ai.learning.panel] Partida interesante");
    safeRecord(0);
    setTimeout(() => {
      console.log("[ai.learning.panel] Entrenando IA tras 'Partida interesante'");
      safeTrain();
    }, 300);
  });

  // Botón extra por si quieres ver resumen / forzar entrenamiento manual
  $btnStats?.addEventListener("click", () => {
    console.log("[ai.learning.panel] Ver resumen / entrenar (manual)");
    safeTrain();
  });
}
