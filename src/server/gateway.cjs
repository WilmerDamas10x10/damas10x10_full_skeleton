// server/gateway.cjs
// Gateway WS con salas y broadcast, accesible en LAN.
// Ejecuta:  node server/gateway.cjs
// Requiere: npm i ws

const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const { WebSocketServer } = require("ws");

// Config
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0"; // ← LAN/any interface

// Utils
function localIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const k in ifs) {
    for (const i of ifs[k] || []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}
function sanitizeRoom(s) {
  return (
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "") || "sala1"
  );
}
const uid = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

// ===============================================
// HTTP/HTTPS server (health + landing)
// ===============================================

// Detectar si tenemos certificados locales (modo DEV con mkcert)
const hasLocalCerts =
  fs.existsSync("./localhost+2.pem") &&
  fs.existsSync("./localhost+2-key.pem");

let server;
let WS_SCHEME = "ws";
let HTTP_SCHEME = "http";

const requestHandler = (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("WS gateway up. Use WS on / or /ws\n");
};

if (hasLocalCerts) {
  // Modo desarrollo local: HTTPS + WSS con los mismos certificados que Vite
  const key = fs.readFileSync("./localhost+2-key.pem");
  const cert = fs.readFileSync("./localhost+2.pem");
  server = https.createServer({ key, cert }, requestHandler);
  WS_SCHEME = "wss";
  HTTP_SCHEME = "https";
  console.log(
    "[ws] DEV TLS habilitado: usando wss:// en local (localhost+2.pem)"
  );
} else {
  // Modo normal (Render u otros entornos sin certificados locales)
  server = http.createServer(requestHandler);
  WS_SCHEME = "ws";
  HTTP_SCHEME = "http";
  console.log(
    "[ws] Modo sin TLS: usando ws:// (no se encontraron certificados locales)"
  );
}

// WS upgrade en / y /ws
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url, `${HTTP_SCHEME}://${req.headers.host}`);
    const ok = url.pathname === "/" || url.pathname === "/ws";
    if (!ok) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req)
    );
  } catch {
    socket.destroy();
  }
});

// Salas
const byRoom = new Map(); // room -> Set<ws>
function joinRoom(ws, room) {
  room = sanitizeRoom(room);
  ws.room = room;
  if (!byRoom.has(room)) byRoom.set(room, new Set());
  byRoom.get(room).add(ws);
}
function leaveRoom(ws) {
  const r = ws.room;
  if (!r) return;
  const set = byRoom.get(r);
  if (set) {
    set.delete(ws);
    if (set.size === 0) byRoom.delete(r);
  }
  ws.room = null;
}
function broadcast(room, data, except) {
  const set = byRoom.get(room);
  if (!set) return;
  for (const client of set) {
    if (client === except) continue;
    if (client.readyState === 1) {
      try {
        client.send(data);
      } catch {}
    }
  }
}

// === peers helper: anunciar número de pares por sala ===
function broadcastPeers(room) {
  const set = byRoom.get(room);
  const peers = set ? set.size : 0;
  const payload = JSON.stringify({ t: "peers", room, peers });
  broadcast(room, payload, null);
}

// Marca de versión/modo para verificar que corres este archivo
console.log("[ws] GATEWAY MODE: no-rate-limit");

// Conexión WS
wss.on("connection", (ws) => {
  ws.id = uid();
  console.log("[ws] connected:", ws.id);

  ws.on("message", (buf) => {
    // 1) Parseo
    let msg;
    try {
      msg = JSON.parse(buf.toString("utf8"));
    } catch {
      return;
    }

    // 2) Rate limit BÁSICO (DESACTIVADO intencionalmente)
    // --- Rate limit básico por socket (≈40 msg/seg) ---
    // const now = Date.now();
    // if (!ws._lastMsgTs) ws._lastMsgTs = now;
    // if (now - ws._lastMsgTs < 25) {
    //   console.warn("[WS] Rate limit hit");
    //   return; // descartamos mensaje demasiado rápido
    // }
    // ws._lastMsgTs = now;

    // 3) Sanitizado mínimo del payload
    if (typeof msg !== "object" || msg === null) return;

    // límite de tamaño (32 KB)
    const MAX_PAYLOAD_SIZE = 32 * 1024;
    if (buf && buf.length > MAX_PAYLOAD_SIZE) {
      console.warn("[WS] Payload demasiado grande");
      return;
    }

    const allowedT = new Set([
      "state",
      "move",
      "ui",
      "hello",
      "join",
      "bye",
      "state_req",
      "replay_req",
      "replay",
      "presence",
      "presence_ack",
      "peers",
      "fen",
    ]);
    if (!allowedT.has(msg.t)) {
      console.warn("[WS] Tipo de mensaje no permitido:", msg.t);
      return;
    }

    // 4) Lógica de salas + broadcast
    const t = msg?.t;
    const room = sanitizeRoom(msg?.room || ws.room || "sala1");

    if (t === "join") {
      if (ws.room && ws.room !== room) leaveRoom(ws);
      joinRoom(ws, room);
      console.log(`[ws] ${ws.id} JOIN room=${room}`);
      // Notificar cantidad de pares a toda la sala
      try {
        broadcastPeers(room);
      } catch {}
      return;
    }

    if (!ws.room) joinRoom(ws, room);

    if (t === "state" || t === "fen" || t === "state_req") {
      console.log(`[ws] ${ws.id} → ${t} room=${ws.room}`);
    } else if (t === "move") {
      console.log(`[ws] ${ws.id} → move room=${ws.room}`);
    } else {
      console.log(`[ws] ${ws.id} → ${t || "?"} room=${ws.room}`);
    }

    try {
      broadcast(ws.room, JSON.stringify({ ...msg, room: ws.room }), ws);
    } catch (e) {
      console.warn("[ws] broadcast error:", e?.message || e);
    }
  });

  ws.on("close", () => {
    console.log("[ws] closed:", ws.id);
    // Guardamos la sala antes de limpiar, para poder anunciar peers correctamente
    const roomBefore = ws.room;
    leaveRoom(ws);
    try {
      if (roomBefore) broadcastPeers(roomBefore);
    } catch {}
  });

  ws.on("error", (err) => {
    console.warn("[ws] error:", ws.id, err?.message || err);
  });
});

// Escuchar en LAN
server.listen(PORT, HOST, () => {
  console.log(
    `WS gateway listening on ${WS_SCHEME}://${HOST}:${PORT}  (paths: / and /ws)`
  );
  for (const ip of localIPs()) {
    console.log(
      `• LAN ${WS_SCHEME}://${ip}:${PORT}   Health: ${HTTP_SCHEME}://${ip}:${PORT}/health`
    );
  }
});
