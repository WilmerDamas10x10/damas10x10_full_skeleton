// ===============================================
// src/ui/pages/Online/ui.layout.js
// SOLO layout HTML del modo Online
// Sin lógica, sin WS, sin movimientos
// ===============================================

export function getOnlineLayoutHTML(DEBUG_PANEL_HTML = "") {
  return `
    <div class="online-layout">

      <!-- Tarjeta principal: [controles izquierda] | [tablero centro] | [WS derecha] -->
      <div class="online-card">

        <!-- Controles de juego (izquierda) -->
        <div class="online-column">
          <span id="turn-info" class="online-btn online-btn--status"></span>

          <button class="online-btn" id="btn-restart">
            <span class="icon-xl">⟳</span>
            <span class="online-btn-text">Reiniciar</span>
          </button>

          <button
            class="online-btn"
            id="btn-rotate"
            title="Invierte la orientación local del tablero"
          >
            <span class="icon-xl">🔁</span>
            <span class="online-btn-text">Orientación: auto (rotar)</span>
          </button>

          <button class="online-btn" id="btn-back">
            <span class="icon-xl">⬅</span>
            <span class="online-btn-text">Volver</span>
          </button>

          <!-- 🔘 Proponer empate -->
          <button class="online-btn" id="btn-offer-draw">
            <span class="icon-xl">🤝</span>
            <span class="online-btn-text">Proponer empate</span>
          </button>

          <!-- 🔘 Rendirse -->
          <button class="online-btn" id="btn-resign">
            <span class="icon-xl">🏳️</span>
            <span class="online-btn-text">Rendirse</span>
          </button>

          <!-- 🔘 Botones de micrófono y cámara -->
          <div
            class="online-media-row"
            style="margin-top:10px; display:flex; flex-direction:column; gap:8px;"
          >
            <button class="online-btn" id="btn-toggle-mic">
              <span class="icon-xl">🎙️</span>
              <span class="online-btn-text">Micrófono</span>
            </button>

            <button class="online-btn" id="btn-toggle-cam">
              <span class="icon-xl">📷</span>
              <span class="online-btn-text">Cámara</span>
            </button>
          </div>

          <!-- 🔴 CONTENEDOR CÁMARA LOCAL + CHAT + VIDEO REMOTO -->
          <div
            id="cam-local-container"
            style="margin-top:10px; display:flex; flex-direction:column; align-items:center; gap:6px; position:relative;"
          >
            <!-- Vista previa de la cámara LOCAL -->
            <video
              id="video-local"
              autoplay
              playsinline
              muted
              style="
                width: 160px;
                height: 120px;
                border-radius: 6px;
                background: #000;
                display: none;
              "
            ></video>

            <!-- Video REMOTO -->
            <video
              id="video-remote"
              autoplay
              playsinline
              style="
                width: 160px;
                height: 120px;
                border-radius: 6px;
                background: #000;
                display: none;
              "
            ></video>
          </div>

        </div>

        <!-- Tablero (centro) -->
        <div id="board"></div>

        <!-- Controles WS (derecha) -->
        <div class="online-column online-column--ws">
          <label class="online-btn">
            <span>WS URL:</span>
            <input
              id="ws-url"
              class="online-btn-input"
              placeholder="ws://localhost:3001"
            >
          </label>

          <label class="online-btn">
            <span>Sala:</span>
            <input
              id="ws-room"
              class="online-btn-input"
              placeholder="sala1"
            >
          </label>

          <button
            class="online-btn online-btn--disconnected"
            id="btn-ws-connect"
          >
            Conectar WS
          </button>

          <span
            id="ws-status"
            class="online-btn online-btn--status"
          >
            WS: Sin conexión
          </span>
        </div>

      </div>

      ${DEBUG_PANEL_HTML}
    </div>
  `;
}
