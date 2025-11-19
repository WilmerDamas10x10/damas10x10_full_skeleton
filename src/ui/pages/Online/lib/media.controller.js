// ===============================================
// src/ui/pages/Online/lib/media.controller.js
// Controlador simple de micrófono y cámara (local)
// - No envía nada por red, solo gestiona getUserMedia.
// - Pensado como pieza reutilizable para otros modos.
// ===============================================

export function createMediaController() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    console.warn("[media.controller] getUserMedia no disponible en este entorno.");
  }

  /** @type {MediaStream|null} */
  let micStream = null;
  /** @type {MediaStream|null} */
  let camStream = null;

  const state = {
    mic: "idle",  // "idle" | "on" | "off" | "error"
    cam: "idle",  // "idle" | "on" | "off" | "error"
  };

  function stopStream(stream) {
    try {
      stream?.getTracks?.().forEach(t => {
        try { t.stop(); } catch {}
      });
    } catch {}
  }

  // --------------------------------------------------
  // MICRÓFONO
  // --------------------------------------------------
  async function toggleMic() {
    // Apagar micrófono
    if (micStream) {
      stopStream(micStream);
      micStream = null;
      state.mic = "off";
      return { ...state };
    }

    // Encender micrófono
    if (!navigator.mediaDevices?.getUserMedia) {
      state.mic = "error";
      console.warn("[media.controller] getUserMedia no disponible para audio.");
      return { ...state };
    }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.mic = "on";
    } catch (err) {
      console.warn("[media.controller] Error al activar micrófono:", err);
      state.mic = "error";
    }
    return { ...state };
  }

  // --------------------------------------------------
  // CÁMARA
  // --------------------------------------------------
  async function toggleCam() {
    // Apagar cámara
    if (camStream) {
      stopStream(camStream);
      camStream = null;
      state.cam = "off";
      return { ...state };
    }

    // Encender cámara
    if (!navigator.mediaDevices?.getUserMedia) {
      state.cam = "error";
      console.warn("[media.controller] getUserMedia no disponible para video.");
      return { ...state };
    }

    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      state.cam = "on";
    } catch (err) {
      console.warn("[media.controller] Error al activar cámara:", err);
      state.cam = "error";
    }
    return { ...state };
  }

  // --------------------------------------------------
  // API interna
  // --------------------------------------------------
  function getState() {
    return { ...state };
  }

  function dispose() {
    stopStream(micStream);
    stopStream(camStream);
    micStream = null;
    camStream = null;
    state.mic = "off";
    state.cam = "off";
  }

  // NUEVO: Exponer el stream de la cámara
  function getVideoStream() {
    return camStream;
  }

  // API pública del controlador
  return {
    toggleMic,
    toggleCam,
    getState,
    dispose,
    getVideoStream,   // ← para conectar con el <video>
  };
}
