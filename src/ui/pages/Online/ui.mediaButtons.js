// ===============================================
// src/ui/pages/Online/ui.mediaButtons.js
// Conecta los botones Micrófono / Cámara y el <video>
// con el media.controller (sólo local, sin red).
// ===============================================

import { createMediaController } from "./lib/media.controller.js";

export function setupMediaButtons({ container }) {
  if (!container) return;

  const $btnMic   = container.querySelector("#btn-toggle-mic");
  const $btnCam   = container.querySelector("#btn-toggle-cam");
  const $video    = container.querySelector("#video-preview");

  if (!$btnMic && !$btnCam) {
    // Nada que hacer si no existe ninguno
    return;
  }

  const media = createMediaController();

  function refreshButtons(state) {
    if (!state) state = media.getState?.() || {};

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

  // Micrófono
  if ($btnMic) {
    $btnMic.addEventListener("click", async () => {
      try {
        const st = await media.toggleMic();
        refreshButtons(st);
      } catch (e) {
        console.warn("[ui.mediaButtons] Error al togglear micrófono:", e);
      }
    });
  }

  // Cámara
  if ($btnCam) {
    $btnCam.addEventListener("click", async () => {
      try {
        const st = await media.toggleCam();
        const stream = media.getVideoStream?.();

        if ($video) {
          if (stream) {
            $video.srcObject = stream;
            $video.style.display = "block";
          } else {
            $video.srcObject = null;
            $video.style.display = "none";
          }
        }

        refreshButtons(st);
      } catch (e) {
        console.warn("[ui.mediaButtons] Error al togglear cámara:", e);
      }
    });
  }

  // Estado inicial
  refreshButtons();
}
