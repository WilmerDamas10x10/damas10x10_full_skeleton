// server/ws-server.js
// Relay WS simple con rooms — ESM — escucha en 0.0.0.0:8090 y path /ws
import http from "http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8090);
const HOST = "0.0.0.0";

function sanitizeRoom(s) {
  return String(s || "sala1")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "") || "sala1";
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ws relay");
});

const wss = new WebSocketServer({ server, path: "/ws" });

const rooms = new Map(); // room -> Set<WebSocket>

function joinRoom(ws, room) {
  room = sanitizeRoom(room);
  ws.__room = room;
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
}

function leaveRoom(ws) {
  const room = ws.__room;
  if (!room) return;
  const set = rooms.get(room);
  if (set) {
    set.delete(ws);
    if (set.size === 0) rooms.delete(room);
  }
  ws.__room = null;
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    const t = msg?.t;

    // Handshake: { t:"join", room }
    if (t === "join") {
      joinRoom(ws, msg?.room || "sala1");
      return;
    }

    // Si aún no hay room, intenta tomarla del mensaje
    if (!ws.__room && msg?.room) joinRoom(ws, msg.room);
    const room = ws.__room || sanitizeRoom(msg?.room || "sala1");

    // Broadcast en la misma room (sin eco)
    const set = rooms.get(room);
    if (!set) return;
    for (const peer of set) {
      if (peer !== ws && peer.readyState === peer.OPEN) {
        try { peer.send(JSON.stringify(msg)); } catch {}
      }
    }
  });

  ws.on("close", () => leaveRoom(ws));
  ws.on("error", () => leaveRoom(ws));
});

// Heartbeat
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false; try { ws.ping(); } catch {}
  }
}, 30000);

server.listen(PORT, HOST, () => {
  console.log(`[ws-relay] listening on http://${HOST}:${PORT} (ws path: /ws)`);
  console.log(`[ws-relay] health:   http://<IP>:${PORT}/health`);
  console.log(`[ws-relay] websocket: ws://<IP>:${PORT}/ws`);
});
