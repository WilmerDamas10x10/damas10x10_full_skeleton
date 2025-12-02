// Servidor WS con salas y heartbeat (ESM)
// Ejecuta: npm run ws  (usa puerto 3001 por defecto)

import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.WS_PORT || 3001;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WS gateway activo");
});

const wss = new WebSocketServer({ server });

// roomName -> Set<ws>
const rooms = new Map();
let nextId = 1;

function safeSend(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

// 🆕 Avisar a todos en la sala cuántos pares remotos tienen
function broadcastPeers(roomName) {
  const set = rooms.get(roomName);
  if (!set) return;
  for (const socket of set) {
    const others = set.size - 1; // número de pares remotos para ese socket
    safeSend(socket, {
      t: "peers",
      room: roomName,
      peers: others,
    });
  }
}

function joinRoom(ws, room) {
  const name = String(room || "sala1");

  // salir de sala previa
  if (ws.room && rooms.has(ws.room)) {
    rooms.get(ws.room).delete(ws);
    if (rooms.get(ws.room).size === 0) rooms.delete(ws.room);
  }

  // entrar a nueva
  ws.room = name;
  if (!rooms.has(name)) rooms.set(name, new Set());
  rooms.get(name).add(ws);

  const currentSize = rooms.get(name).size;

  // Respuesta solo al que se acaba de unir
  safeSend(ws, {
    t: "join_ok",
    room: name,
    peers: currentSize - 1, // pares remotos para él
  });

  // 🆕 Notificar a todos (incluido él) el número de pares
  broadcastPeers(name);
}

wss.on("connection", (ws) => {
  ws.id = `c${nextId++}`;
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.t === "hello" || msg.t === "join") {
      joinRoom(ws, msg.room);
      return;
    }

    const room = ws.room || msg.room;
    if (!room || !rooms.has(room)) return;

    const out = { ...msg, serverTs: Date.now() };

    // reenviar a todos los demás de la sala
    for (const peer of rooms.get(room)) {
      if (peer !== ws && peer.readyState === peer.OPEN) {
        safeSend(peer, out);
      }
    }
  });

  ws.on("close", () => {
    const roomName = ws.room;
    if (roomName && rooms.has(roomName)) {
      rooms.get(roomName).delete(ws);
      if (rooms.get(roomName).size === 0) {
        rooms.delete(roomName);
      } else {
        // 🆕 alguien se fue: actualizar conteo de pares
        broadcastPeers(roomName);
      }
    }
  });

  ws.on("error", () => {});
});

// Heartbeat para limpiar conexiones muertas
const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {}
  }
}, 30000);

wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`[WS] Gateway escuchando en ws://localhost:${PORT}`);
});
