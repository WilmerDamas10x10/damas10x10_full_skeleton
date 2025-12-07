// ================================
// src/ui/efectosSonido.js
// Efectos de sonido genéricos de la interfaz
// A: hover / enfoque
// B: click / confirmación
// ================================

let hoverAudio;
let clickAudio;

function ensureAudios() {
  if (!hoverAudio) {
    hoverAudio = new Audio("/sonidos/tono_A1.wav");
    hoverAudio.volume = 0.35; // ajusta si quieres más/menos volumen
  }
  if (!clickAudio) {
    clickAudio = new Audio("/sonidos/tono_B1.wav");
    clickAudio.volume = 0.4; // un poquito más fuerte para el click
  }
}

export function playHover() {
  try {
    ensureAudios();
    // Reinicia el sonido para que suene siempre aunque se dispare seguido
    hoverAudio.currentTime = 0;
    hoverAudio.play().catch(() => {
      // Algunos navegadores bloquean el audio si no hubo interacción previa
    });
  } catch (err) {
    // Silencioso
    // console.error("[SONIDO] Error en playHover", err);
  }
}

export function playClick() {
  try {
    ensureAudios();
    clickAudio.currentTime = 0;
    clickAudio.play().catch(() => {});
  } catch (err) {
    // Silencioso
    // console.error("[SONIDO] Error en playClick", err);
  }
}
