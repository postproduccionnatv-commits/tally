// ─────────────────────────────────────────────────────────────
//  TALLY RELAY SERVER
//  Este servidor vive en la nube (Render).
//  Actúa de puente entre:
//    - El PC del estudio  (se conecta como "bridge")
//    - Los smartphones    (se conectan como "client")
// ─────────────────────────────────────────────────────────────

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);

// Socket.io permite conexiones WebSocket en tiempo real
const io = new Server(httpServer, {
  cors: { origin: "*" }, // Permite conexiones desde cualquier sitio
});

// ── Estado actual del tally ──────────────────────────────────
// Guardamos el último estado para que un smartphone que se
// conecte tarde reciba el estado actual de inmediato.
let tallyState = {
  inputs: {}, // { "Input 1": "pgm", "Input 2": "prev", ... }
  connectedBridge: false,
  lastUpdate: null,
};

// ── Página de estado (abrir en navegador para ver si funciona)
app.get("/", (req, res) => {
  const bridgeStatus = tallyState.connectedBridge ? "✅ Conectado" : "❌ Desconectado";
  const clients = io.sockets.sockets.size;
  res.send(`
    <h2>Tally Relay Server</h2>
    <p>Bridge (estudio): <b>${bridgeStatus}</b></p>
    <p>Clientes conectados: <b>${clients}</b></p>
    <p>Último estado: <pre>${JSON.stringify(tallyState.inputs, null, 2)}</pre></p>
    <p>Última actualización: ${tallyState.lastUpdate || "—"}</p>
  `);
});

// ── Lógica de conexiones ─────────────────────────────────────
io.on("connection", (socket) => {

  const role = socket.handshake.query.role; // "bridge" o "client"
  const secret = socket.handshake.query.secret;

  // Seguridad básica: el bridge debe enviar una clave secreta
  const BRIDGE_SECRET = process.env.BRIDGE_SECRET || "tally-secret-123";

  // ── Si se conecta el BRIDGE (PC del estudio) ──────────────
  if (role === "bridge") {
    if (secret !== BRIDGE_SECRET) {
      console.log("Bridge rechazado: clave incorrecta");
      socket.disconnect();
      return;
    }

    console.log("✅ Bridge conectado desde el estudio");
    tallyState.connectedBridge = true;

    // Avisar a todos los smartphones que el estudio está online
    io.emit("bridge-status", { connected: true });

    // El bridge envía actualizaciones de tally
    socket.on("tally-update", (data) => {
      // data = { inputs: { "Input 1": "pgm", "Input 2": "inactive", ... } }
      console.log("📡 Tally update:", data);
      tallyState.inputs = data.inputs;
      tallyState.lastUpdate = new Date().toISOString();

      // Reenviar a TODOS los smartphones conectados
      socket.broadcast.emit("tally-update", data);
    });

    socket.on("disconnect", () => {
      console.log("❌ Bridge desconectado");
      tallyState.connectedBridge = false;
      tallyState.inputs = {};
      io.emit("bridge-status", { connected: false });
    });

  // ── Si se conecta un SMARTPHONE ───────────────────────────
  } else {
    console.log(`📱 Cliente conectado (total: ${io.sockets.sockets.size})`);

    // Enviar el estado actual inmediatamente al conectarse
    socket.emit("tally-update", { inputs: tallyState.inputs });
    socket.emit("bridge-status", { connected: tallyState.connectedBridge });

    socket.on("disconnect", () => {
      console.log(`📱 Cliente desconectado (total: ${io.sockets.sockets.size - 1})`);
    });
  }
});

// ── Arrancar el servidor ─────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Tally Relay escuchando en puerto ${PORT}`);
});
