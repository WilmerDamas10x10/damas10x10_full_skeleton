// ===============================================
// src/ui/pages/Online/ui.mediaButtons.js
// Botones Micrófono / Cámara + <video> de preview
// Integrado con WebRTC (rtc.controller) si se pasa
// un objeto `rtc` desde mountOnline.
// -----------------------------------------------
// Si NO se pasa `rtc`, hace un fallback LOCAL:
// usa getUserMedia sólo en este dispositivo.
// ===============================================

export function setupMediaButtons({ container, rtc }) {
  if (!container) return;

  const $btnMic   = container.querySelector("#btn-toggle-mic");
  const $btnCam   = container.querySelector("#btn-toggle-cam");
  const $video    = container.querySelector("#video-preview");

  if (!$btnMic && !$btnCam) {
    // Nada que hacer si no existe ninguno
    return;
  }

  // Estado simple para labels
  const state = {
    mic: "off",   // "off" | "on" | "error"
    cam: "off",   // "off" | "on" | "error"
  };

  // Fallback local (si no hay rtc): stream sólo en este dispositivo
  let localFallbackStream = null;

  function refreshButtons() {
    // Micrófono
    if ($btnMic) {
      if (state.mic === "on") {
        $btnMic.textContent = "Micrófono: ON";
        $btnMic.dataset.active = "1";
      } else if (state.mic === "error") {
        $btnMic.textContent = "Micrófono: ERROR";
        $btnMic.dataset.active = "0";
      } else if (state.mic === "off") {
        $btnMic.textContent = "Micrófono: OFF";
        $btnMic.dataset.active = "0";
      } else {
        $btnMic.textContent = "Micrófono";
        $btnMic.dataset.active = "0";
      }
    }

    // Cámara
    if ($btnCam) {
      if (state.cam === "on") {
        $btnCam.textContent = "Cámara: ON";
        $btnCam.dataset.active = "1";
      } else if (state.cam === "error") {
        $btnCam.textContent = "Cámara: ERROR";
        $btnCam.dataset.active = "0";
      } else if (state.cam === "off") {
        $btnCam.textContent = "Cámara: OFF";
        $btnCam.dataset.active = "0";
      } else {
        $btnCam.textContent = "Cámara";
        $btnCam.dataset.active = "0";
      }
    }
  }

  // -------------------------------------------
  // Helpers para manejar el <video> de preview
  // -------------------------------------------
  function attachVideoStream(stream) {
    if (!$video) return;
    if (stream) {
      $video.srcObject = stream;
      $video.style.display = "block";
    } else {
      $video.srcObject = null;
      $video.style.display = "none";
    }
  }

  function stopStreamTracks(stream) {
    if (!stream) return;
    try {
      stream.getTracks().forEach(t => t.stop());
    } catch {}
  }

  // -------------------------------------------
  // Cámara: ON/OFF
  // -------------------------------------------
  async function toggleCam() {
    // Si está apagada → encender
    if (state.cam !== "on") {
      // === MODO WebRTC (rtc disponible) ===
      if (rtc && typeof rtc.startLocalMedia === "function") {
        try {
          // Pedimos cámara + audio local vía RTC
          const stream = await rtc.startLocalMedia({ video: true, audio: true });

          // El propio rtc.controller ya llama a onLocalStream (si lo configuramos),
          // pero aseguramos aquí también que el <video> local tenga el stream.
          attachVideoStream(stream || rtc.getLocalStream?.() || null);

          // Iniciamos como "caller": mandará offer por WS (t:"ui", op:"rtc")
          await rtc.startAsCaller();

          state.cam = "on";

          const s = rtc.getLocalStream?.() || stream;
          const hasAudio = !!(s && s.getAudioTracks && s.getAudioTracks().some(t => t.enabled));
          state.mic = hasAudio ? "on" : "off";

        } catch (e) {
          console.warn("[ui.mediaButtons] Error al iniciar cámara (RTC):", e);
          state.cam = "error";
          state.mic = "error";
          attachVideoStream(null);
        }
        refreshButtons();
        return;
      }

      // === FALLBACK LOCAL (sin rtc) ===
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localFallbackStream = stream;
        attachVideoStream(stream);
        state.cam = "on";

        const hasAudio = stream.getAudioTracks().some(t => t.enabled);
        state.mic = hasAudio ? "on" : "off";
      } catch (e) {
        console.warn("[ui.mediaButtons] Error al iniciar cámara (local):", e);
        state.cam = "error";
        state.mic = "error";
        attachVideoStream(null);
      }
      refreshButtons();
      return;
    }

    // Si está encendida → apagar
    // === MODO WebRTC ===
    if (rtc && typeof rtc.stopAll === "function") {
      try {
        rtc.stopAll();
      } catch (e) {
        console.warn("[ui.mediaButtons] Error al parar RTC:", e);
      }
    }

    // === FALLBACK LOCAL ===
    stopStreamTracks(localFallbackStream);
    localFallbackStream = null;

    attachVideoStream(null);
    state.cam = "off";
    state.mic = "off";
    refreshButtons();
  }

  // -------------------------------------------
  // Micrófono: ON/OFF (mute/unmute)
  // -------------------------------------------
  async function toggleMic() {
    // === MODO WebRTC ===
    if (rtc && typeof rtc.getLocalStream === "function") {
      const stream = rtc.getLocalStream();
      if (!stream) {
        // Para simplificar: pedimos que encienda primero la cámara/llamada
        alert("Primero enciende la cámara para iniciar la llamada.");
        return;
      }

      const audioTracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
      if (!audioTracks.length) {
        console.warn("[ui.mediaButtons] No hay pistas de audio en el stream RTC.");
        state.mic = "error";
        refreshButtons();
        return;
      }

      // Si algún track está enabled → silenciamos todo
      const anyEnabled = audioTracks.some(t => t.enabled);
      const newEnabled = !anyEnabled;
      audioTracks.forEach(t => { t.enabled = newEnabled; });

      state.mic = newEnabled ? "on" : "off";
      refreshButtons();
      return;
    }

    // === FALLBACK LOCAL (sin rtc) ===
    if (!localFallbackStream) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localFallbackStream = stream;
        const tracks = stream.getAudioTracks();
        if (tracks.length) {
          tracks.forEach(t => { t.enabled = true; });
          state.mic = "on";
        } else {
          state.mic = "error";
        }
      } catch (e) {
        console.warn("[ui.mediaButtons] Error al iniciar micrófono (local):", e);
        state.mic = "error";
      }
      refreshButtons();
      return;
    }

    const tracks = localFallbackStream.getAudioTracks ? localFallbackStream.getAudioTracks() : [];
    if (!tracks.length) {
      state.mic = "error";
      refreshButtons();
      return;
    }
    const anyEnabled = tracks.some(t => t.enabled);
    const newEnabled = !anyEnabled;
    tracks.forEach(t => { t.enabled = newEnabled; });

    state.mic = newEnabled ? "on" : "off";
    refreshButtons();
  }

  // -------------------------------------------
  // Wire de los botones
  // -------------------------------------------

  if ($btnCam) {
    $btnCam.addEventListener("click", () => {
      toggleCam().catch(e => {
        console.warn("[ui.mediaButtons] toggleCam error:", e);
      });
    });
  }

  if ($btnMic) {
    $btnMic.addEventListener("click", () => {
      toggleMic().catch(e => {
        console.warn("[ui.mediaButtons] toggleMic error:", e);
      });
    });
  }

  // Estado inicial
  refreshButtons();
}
