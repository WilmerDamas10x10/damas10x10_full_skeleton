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
    const inChain = !!(stepState && Array.isArray(stepState.deferred) && stepState.deferred.length > 0);
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
