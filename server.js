const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// ── Servir la PWA (archivos estáticos) ──────────────────────
app.use(express.static(path.join(__dirname, "public")));

// Estado actual del tally
let tallyState = {
  inputs: {},
  connectedBridge: false,
  lastUpdate: null,
};

// ── Página de estado para administrador ─────────────────────
app.get("/status", (req, res) => {
  const bridgeStatus = tallyState.connectedBridge ? "✅ Conectado" : "❌ Desconectado";
  const clients = io.sockets.sockets.size;
  res.send(`
    <h2>Tally Relay — Estado</h2>
    <p>Bridge (estudio): <b>${bridgeStatus}</b></p>
    <p>Clientes conectados: <b>${clients}</b></p>
    <p>Último tally: <pre>${JSON.stringify(tallyState.inputs, null, 2)}</pre></p>
    <p>Última actualización: ${tallyState.lastUpdate || "—"}</p>
  `);
});

// ── Lógica de conexiones ─────────────────────────────────────
io.on("connection", (socket) => {
  const role = socket.handshake.query.role;
  const secret = socket.handshake.query.secret;
  const BRIDGE_SECRET = process.env.BRIDGE_SECRET || "tally-estudio-2024";

  if (role === "bridge") {
    if (secret !== BRIDGE_SECRET) {
      console.log("Bridge rechazado: clave incorrecta");
      socket.disconnect();
      return;
    }
    console.log("✅ Bridge conectado");
    tallyState.connectedBridge = true;
    io.emit("bridge-status", { connected: true });

    socket.on("tally-update", (data) => {
      console.log("📡 Tally update:", data);
      tallyState.inputs = data.inputs;
      tallyState.lastUpdate = new Date().toISOString();
      socket.broadcast.emit("tally-update", data);
    });

    socket.on("disconnect", () => {
      console.log("❌ Bridge desconectado");
      tallyState.connectedBridge = false;
      tallyState.inputs = {};
      io.emit("bridge-status", { connected: false });
    });

  } else {
    console.log(`📱 Cliente conectado (total: ${io.sockets.sockets.size})`);
    socket.emit("tally-update", { inputs: tallyState.inputs });
    socket.emit("bridge-status", { connected: tallyState.connectedBridge });

    socket.on("disconnect", () => {
      console.log(`📱 Cliente desconectado`);
    });
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Tally Relay + PWA en puerto ${PORT}`);
});
