// ===============================================
// src/ui/pages/Online/ui.buttons.js
// Botones del modo Online (Volver / Reiniciar / Rotar)
// NO toca reglas ni motor, solo UI y navegación.
// ===============================================

export function setupOnlineButtons({
  container,
  updateOrientButton,
  getFlipOrientation,
  setFlipOrientation,
  saveFlip,
  getCurrentRoom,
  urlRoom,
  render,
  getSeqCtl,
  closeTransport,
  netSend,
  isSpectator,
  getStepState,
}) {
  const $btnRotate  = container.querySelector("#btn-rotate");
  const $btnBack    = container.querySelector("#btn-back");
  const $btnRestart = container.querySelector("#btn-restart");

  // --- ROTAR TABLERO ---
  $btnRotate?.addEventListener("click", () => {
    const newVal = !getFlipOrientation();
    setFlipOrientation(newVal);

    const room = getCurrentRoom() || urlRoom;
    saveFlip(room, newVal);

    updateOrientButton();
    render();
  });

  // --- VOLVER AL MENÚ ---
  $btnBack?.addEventListener("click", () => {
    try { getSeqCtl()?.dispose?.(); } catch {}
    closeTransport();
    container.innerHTML = "";
    import("../Home/index.js").then(mod => mod.default?.(container));
  });

  // --- REINICIAR PARTIDA (handshake con el otro jugador) ---
  $btnRestart?.addEventListener("click", () => {
    if (isSpectator) return;

    const stepState = getStepState();
    const inChain = !!(
      stepState &&
      Array.isArray(stepState.deferred) &&
      stepState.deferred.length > 0
    );
    if (inChain) {
      try { alert("Termina la cadena antes de reiniciar."); } catch {}
      return;
    }

    const ok = confirm("¿Quieres solicitar reiniciar la partida al otro jugador?");
    if (!ok) return;

    netSend({ t: "ui", op: "restart_req" });
    try {
      alert("Solicitud de reinicio enviada. Esperando confirmación del otro jugador.");
    } catch {}
  });
}

// ===============================================
// 🔘 Empate / Rendirse
// ===============================================
export function setupDrawAndResignButtons({
  container,
  isSpectator,
  netSend,
  hardRestart,
}) {
  const $btnOfferDraw = container.querySelector("#btn-offer-draw");
  const $btnResign    = container.querySelector("#btn-resign");

  // Si no hay botones, nada que hacer
  if (!$btnOfferDraw && !$btnResign) return;

  // Ocultar si es espectador
  if (isSpectator) {
    if ($btnOfferDraw) $btnOfferDraw.style.display = "none";
    if ($btnResign)    $btnResign.style.display    = "none";
    return;
  }

  // 🤝 Proponer EMPATE
  if ($btnOfferDraw) {
    $btnOfferDraw.addEventListener("click", () => {
      const ok = confirm("¿Quieres proponer EMPATE a tu rival?");
      if (!ok) return;
      netSend({ t: "ui", op: "offer_draw" });
    });
  }

  // 🏳️ RENDIRSE / CEDER PARTIDA
  if ($btnResign) {
    $btnResign.addEventListener("click", () => {
      const ok = confirm(
        "¿Seguro que quieres rendirte y dar la partida por perdida?"
      );
      if (!ok) return;

      netSend({ t: "ui", op: "resign" });

      try {
        alert("Has cedido la partida. Comienza una nueva partida.");
      } catch {}

      // Reinicio duro local (lo que ya hacías en mountOnline)
      hardRestart();
    });
  }
}
