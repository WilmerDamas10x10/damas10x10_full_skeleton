// ===============================================
// src/ui/pages/Online/ui.mediaButtons.js
// Botones Micrófono / Cámara + <video> de preview
// -----------------------------------------------
// - Si HAY `rtc`: los botones sólo controlan
//   las pistas locales (audio/video) y arrancan
//   la llamada como "caller" cuando toca.
//   El <video id="video-preview"> se usa
//   SOLO para el stream REMOTO (lo controla
//   mountOnline via onRemoteStream).
//
// - Si NO hay `rtc`: Fallback LOCAL usando
//   getUserMedia, y el <video> muestra tu
//   propia cámara (muted).
// ===============================================

export function setupMediaButtons({ container, rtc }) {
  if (!container) return;

  const $btnMic = container.querySelector("#btn-toggle-mic");
  const $btnCam = container.querySelector("#btn-toggle-cam");
  const $video  = container.querySelector("#video-preview");

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
        $btnMic.textContent = "🎤 Micrófono: ON";
        $btnMic.dataset.active = "1";
      } else if (state.mic === "error") {
        $btnMic.textContent = "⚠️ Micrófono: ERROR";
        $btnMic.dataset.active = "0";
      } else if (state.mic === "off") {
        $btnMic.textContent = "🔇 Micrófono: OFF";
        $btnMic.dataset.active = "0";
      } else {
        $btnMic.textContent = "🎤 Micrófono";
        $btnMic.dataset.active = "0";
      }
    }

    // Cámara
    if ($btnCam) {
      if (state.cam === "on") {
        $btnCam.textContent = "📷 Cámara: ON";
        $btnCam.dataset.active = "1";
      } else if (state.cam === "error") {
        $btnCam.textContent = "⚠️ Cámara: ERROR";
        $btnCam.dataset.active = "0";
      } else if (state.cam === "off") {
        $btnCam.textContent = "🚫 Cámara: OFF";
        $btnCam.dataset.active = "0";
      } else {
        $btnCam.textContent = "📷 Cámara";
        $btnCam.dataset.active = "0";
      }
    }
  }

  // -------------------------------------------
  // Helpers para manejar el <video> de preview
  // (SOLO usado en Fallback local, sin RTC)
  // -------------------------------------------
  function attachVideoStream(stream) {
    if (!$video) return;

    if (stream) {
      $video.srcObject = stream;
      $video.style.display = "block";

      // En fallback, por seguridad, lo dejamos muteado
      $video.muted = true;
      $video.volume = 0;
      $video.playsInline = true;
      $video.autoplay = true;

      try {
        const p = $video.play();
        if (p && typeof p.then === "function") {
          p.catch(() => {});
        }
      } catch {}
    } else {
      $video.srcObject = null;
      $video.style.display = "none";
    }
  }

  function stopStreamTracks(stream) {
    if (!stream) return;
    try {
      stream.getTracks().forEach((t) => t.stop());
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
          // Si ya hay stream RTC, lo reutilizamos; si no, lo creamos
          let stream = rtc.getLocalStream?.() || null;
          if (!stream) {
            // Pedimos cámara + audio local vía RTC
            stream = await rtc.startLocalMedia({ video: true, audio: true });
          }

          // Aseguramos que el video esté habilitado cuando la cámara está ON
          const s = rtc.getLocalStream?.() || stream || null;
          if (s && s.getVideoTracks) {
            const vTracks = s.getVideoTracks();
            vTracks.forEach((t) => {
              t.enabled = true;
            });
          }

          // ⛔ IMPORTANTE: NO conectamos este stream local al <video>,
          // porque ese <video> se reserva para el stream REMOTO.
          // (El preview local se podría manejar en otro <video> si quisiéramos).

          // Iniciamos como "caller": mandará offer por WS (t:"ui", op:"rtc")
          if (typeof rtc.startAsCaller === "function") {
            await rtc.startAsCaller();
          }

          state.cam = "on";

          // Si hay audio en el mismo stream, lo marcamos como ON
          const audioTracks = s && s.getAudioTracks ? s.getAudioTracks() : [];
          const hasAudio =
            !!audioTracks.length && audioTracks.some((t) => t.enabled);
          if (hasAudio) {
            state.mic = "on";
          }
        } catch (e) {
          console.warn(
            "[ui.mediaButtons] Error al iniciar cámara (RTC):",
            e
          );
          state.cam = "error";
          state.mic = "error";
        }
        refreshButtons();
        return;
      }

      // === FALLBACK LOCAL (sin rtc) ===
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localFallbackStream = stream;
        attachVideoStream(stream);
        state.cam = "on";

        const hasAudio = stream
          .getAudioTracks()
          .some((t) => t.enabled);
        state.mic = hasAudio ? "on" : state.mic;
      } catch (e) {
        console.warn(
          "[ui.mediaButtons] Error al iniciar cámara (local):",
          e
        );
        state.cam = "error";
        state.mic = "error";
        attachVideoStream(null);
      }
      refreshButtons();
      return;
    }

    // Si está encendida → apagar
    // === MODO WebRTC ===
    if (rtc && typeof rtc.getLocalStream === "function") {
      try {
        const stream = rtc.getLocalStream();
        if (stream && stream.getVideoTracks) {
          const vTracks = stream.getVideoTracks();
          vTracks.forEach((t) => {
            t.enabled = false;
          });
        }
      } catch (e) {
        console.warn(
          "[ui.mediaButtons] Error al desactivar video (RTC):",
          e
        );
      }
    } else {
      // === FALLBACK LOCAL ===
      stopStreamTracks(localFallbackStream);
      localFallbackStream = null;
      state.mic = "off";
    }

    // En ambos casos, el <video> principal se apaga en fallback;
    // en RTC, el <video> lo controla mountOnline con el stream remoto.
    attachVideoStream(null);
    state.cam = "off";
    refreshButtons();
  }

  // -------------------------------------------
  // Micrófono: ON/OFF (mute/unmute)
  // -------------------------------------------
  async function toggleMic() {
    // === MODO WebRTC ===
    if (rtc && typeof rtc.getLocalStream === "function") {
      let stream = rtc.getLocalStream();

      // Si no hay stream aún, lo creamos aquí SIN forzar cámara visible
      if (!stream) {
        try {
          // Pedimos audio+video, pero dejaremos el video desactivado.
          stream = await rtc.startLocalMedia({
            audio: true,
            video: true,
          });

          const s = rtc.getLocalStream?.() || stream || null;

          if (s) {
            // Activamos audio
            const audioTracksInit = s.getAudioTracks
              ? s.getAudioTracks()
              : [];
            if (audioTracksInit.length) {
              audioTracksInit.forEach((t) => {
                t.enabled = true;
              });
              state.mic = "on";
            } else {
              console.warn(
                "[ui.mediaButtons] No hay pistas de audio tras startLocalMedia (RTC)."
              );
              state.mic = "error";
            }

            // Desactivamos video para que la cámara siga "OFF"
            const videoTracksInit = s.getVideoTracks
              ? s.getVideoTracks()
              : [];
            if (videoTracksInit.length) {
              videoTracksInit.forEach((t) => {
                t.enabled = false;
              });
            }
          } else {
            state.mic = "error";
          }

          // 🚀 Importante: si la llamada aún no ha empezado, arrancarla aquí
          if (
            typeof rtc.startAsCaller === "function" &&
            typeof rtc.getState === "function"
          ) {
            const st = rtc.getState();
            if (!st || !st.isStarted) {
              await rtc.startAsCaller();
            }
          }

          // No mostramos preview de vídeo aquí, porque el <video> es remoto.
          refreshButtons();
          return;
        } catch (e) {
          console.warn(
            "[ui.mediaButtons] Error al iniciar micrófono (RTC):",
            e
          );
          state.mic = "error";
          refreshButtons();
          return;
        }
      }

      // Si ya hay stream RTC, sólo mute/unmute de audio
      const audioTracks = stream.getAudioTracks
        ? stream.getAudioTracks()
        : [];
      if (!audioTracks.length) {
        console.warn(
          "[ui.mediaButtons] No hay pistas de audio en el stream RTC."
        );
        state.mic = "error";
        refreshButtons();
        return;
      }

      // Si algún track está enabled → silenciamos todo
      const anyEnabled = audioTracks.some((t) => t.enabled);
      const newEnabled = !anyEnabled;
      audioTracks.forEach((t) => {
        t.enabled = newEnabled;
      });

      state.mic = newEnabled ? "on" : "off";

      // Si acabamos de pasar a ON y la llamada aún no está iniciada,
      // arrancamos como caller.
      if (
        newEnabled &&
        typeof rtc.startAsCaller === "function" &&
        typeof rtc.getState === "function"
      ) {
        const st = rtc.getState();
        if (!st || !st.isStarted) {
          try {
            await rtc.startAsCaller();
          } catch (e) {
            console.warn(
              "[ui.mediaButtons] Error al iniciar llamada desde mic (RTC):",
              e
            );
          }
        }
      }

      refreshButtons();
      return;
    }

    // === FALLBACK LOCAL (sin rtc) ===
    if (!localFallbackStream) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        localFallbackStream = stream;
        const tracks = stream.getAudioTracks();
        if (tracks.length) {
          tracks.forEach((t) => {
            t.enabled = true;
          });
          state.mic = "on";
        } else {
          state.mic = "error";
        }
      } catch (e) {
        console.warn(
          "[ui.mediaButtons] Error al iniciar micrófono (local):",
          e
        );
        state.mic = "error";
      }
      refreshButtons();
      return;
    }

    const tracks = localFallbackStream.getAudioTracks
      ? localFallbackStream.getAudioTracks()
      : [];
    if (!tracks.length) {
      state.mic = "error";
      refreshButtons();
      return;
    }
    const anyEnabled = tracks.some((t) => t.enabled);
    const newEnabled = !anyEnabled;
    tracks.forEach((t) => {
      t.enabled = newEnabled;
    });

    state.mic = newEnabled ? "on" : "off";
    refreshButtons();
  }

  // -------------------------------------------
  // Wire de los botones
  // -------------------------------------------

  if ($btnCam) {
    $btnCam.addEventListener("click", () => {
      toggleCam().catch((e) => {
        console.warn("[ui.mediaButtons] toggleCam error:", e);
      });
    });
  }

  if ($btnMic) {
    $btnMic.addEventListener("click", () => {
      toggleMic().catch((e) => {
        console.warn("[ui.mediaButtons] toggleMic error:", e);
      });
    });
  }

  // Estado inicial
  refreshButtons();
}
