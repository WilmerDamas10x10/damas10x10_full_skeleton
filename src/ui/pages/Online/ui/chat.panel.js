// ===============================================
// src/ui/pages/Online/ui/chat.panel.js
// Panel visual del CHAT (plegable) para modo Online
// -----------------------------------------------
// Se monta en el contenedor que le pases (por ejemplo,
// en la columna derecha debajo de la cámara).
// Cambios 2025-12-01:
// - Inicia colapsado por defecto.
// - Panel se despliega DEBAJO del botón "Chat" (layout vertical).
// - Frases rápidas compactas con "Ver más / Ver menos".
// - Botón para añadir frases personalizadas.
// - Clic derecho en frase personalizada → eliminar.
// ===============================================

import "./chat.panel.css";

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.rootElement  // contenedor donde se monta
 * @param {ReturnType<import("../lib/chat.controller.js").createChatController>} opts.controller
 */
export function mountOnlineChatPanel(opts) {
  const root = opts && opts.rootElement;
  const controller = opts && opts.controller;
  if (!root || !controller) return;

  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "online-chat-panel";

  // ───── CABECERA / BOTÓN PLEGABLE ─────
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "online-btn online-chat-toggle";
  toggleBtn.innerHTML = `
    <span class="online-chat-toggle-label">💬 Chat</span>
    <span class="online-chat-unread" hidden></span>
    <span class="online-chat-toggle-arrow">▾</span>
  `;
  wrap.appendChild(toggleBtn);

  // ───── CUERPO PLEGABLE ─────
  const body = document.createElement("div");
  body.className = "online-chat-body";
  body.hidden = true; // ⬅ colapsado por defecto

  // Lista de mensajes
  const msgList = document.createElement("div");
  msgList.className = "online-chat-messages";

  // Bloque de frases rápidas (vertical)
  const quickWrap = document.createElement("div");
  quickWrap.className = "online-chat-quick-wrap-vertical";

  const quickRow = document.createElement("div");
  quickRow.className = "online-chat-quick-row";

  const verMasBtn = document.createElement("button");
  verMasBtn.type = "button";
  verMasBtn.className = "online-chat-vermas-btn";
  verMasBtn.textContent = "Ver más";
  verMasBtn.hidden = true;

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "online-chat-add-btn";
  addBtn.textContent = "+ Añadir frase";

  // Input + botón enviar
  const form = document.createElement("form");
  form.className = "online-chat-form";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "online-chat-input";
  input.placeholder = "Escribe un mensaje…";

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "online-btn online-chat-send";
  sendBtn.textContent = "Enviar";

  form.appendChild(input);
  form.appendChild(sendBtn);

  quickWrap.appendChild(quickRow);
  quickWrap.appendChild(verMasBtn);
  quickWrap.appendChild(addBtn);

  body.appendChild(msgList);
  body.appendChild(quickWrap);
  body.appendChild(form);

  wrap.appendChild(body);
  root.appendChild(wrap);

  // ───── ESTADO LOCAL (solo del panel) ─────
  let quickExpanded = false;

  function formatTime(ts) {
    try {
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    } catch {
      return "";
    }
  }

  function renderQuickPhrases() {
    quickRow.innerHTML = "";

    const state = controller.getState();
    const quick = state.quickPhrases || [];

    const maxCompact = 3;
    const visible = quickExpanded ? quick : quick.slice(0, maxCompact);

    for (let i = 0; i < visible.length; i++) {
      const txt = visible[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "online-chat-quick-btn";
      btn.textContent = txt;

      // Click normal → enviar frase
      btn.addEventListener("click", () => {
        controller.sendQuickPhrase(i);
        input.focus();
      });

      // Clic derecho → si es personalizada, ofrecer eliminar
      if (
        typeof controller.isCustomPhrase === "function" &&
        controller.isCustomPhrase(txt)
      ) {
        btn.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          const ok = confirm(
            "¿Eliminar esta frase personalizada?\n\n" + txt
          );
          if (!ok) return;
          if (typeof controller.removeCustomPhrase === "function") {
            controller.removeCustomPhrase(txt);
          }
        });
      }

      quickRow.appendChild(btn);
    }

    if (quick.length > maxCompact) {
      verMasBtn.hidden = false;
      verMasBtn.textContent = quickExpanded ? "Ver menos" : "Ver más";
    } else {
      verMasBtn.hidden = true;
    }
  }

  // ───── RENDER PRINCIPAL ─────
  function render() {
    const state = controller.getState();
    const isOpen = !!(state && state.isOpen);

    body.hidden = !isOpen;

    if (isOpen) wrap.classList.add("online-chat-open");
    else wrap.classList.remove("online-chat-open");

    toggleBtn.classList.toggle("online-chat-toggle--open", isOpen);

    // badge de no leídos
    const unreadSpan = toggleBtn.querySelector(".online-chat-unread");
    if (unreadSpan) {
      if (state.unread > 0) {
        unreadSpan.hidden = false;
        unreadSpan.textContent = String(state.unread);
      } else {
        unreadSpan.hidden = true;
        unreadSpan.textContent = "";
      }
    }

    // mensajes
    msgList.innerHTML = "";
    const msgs = state.messages || [];
    for (const msg of msgs) {
      const item = document.createElement("div");
      item.className = "online-chat-message";

      if (msg.from === "me") {
        item.classList.add("online-chat-message-me");
      } else {
        item.classList.add("online-chat-message-remote");
      }

      const bubble = document.createElement("div");
      bubble.className = "online-chat-bubble";
      bubble.textContent = msg.text;

      const meta = document.createElement("div");
      meta.className = "online-chat-meta";
      meta.textContent = formatTime(msg.ts);

      item.appendChild(bubble);
      item.appendChild(meta);
      msgList.appendChild(item);
    }

    if (msgList.scrollHeight > msgList.clientHeight) {
      msgList.scrollTop = msgList.scrollHeight;
    }

    renderQuickPhrases();
  }

  const unsubscribe = controller.subscribe(render);

  // ───── INTERACCIONES ─────
  toggleBtn.addEventListener("click", () => {
    controller.toggle();
  });

  verMasBtn.addEventListener("click", () => {
    quickExpanded = !quickExpanded;
    render();
  });

  addBtn.addEventListener("click", () => {
    const newPhrase = prompt("Nueva frase rápida:");
    if (!newPhrase) return;
    if (typeof controller.addCustomPhrase === "function") {
      controller.addCustomPhrase(newPhrase);
    }
    quickExpanded = true;
    render();
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value;
    controller.sendText(text);
    input.value = "";
    input.focus();
  });

  // Limpieza si se desmonta el root
  const obs = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      try {
        unsubscribe();
      } catch {}
      try {
        obs.disconnect();
      } catch {}
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
