const express    = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path       = require("path");
const { AccessToken } = require("livekit-server-sdk");

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── LiveKit config ────────────────────────────────────────────
const LK_URL    = process.env.LIVEKIT_URL        || "wss://talliacom-6dqu9dpl.livekit.cloud";
const LK_KEY    = process.env.LIVEKIT_API_KEY     || "APIrPEUu7AF7BAC";
const LK_SECRET = process.env.LIVEKIT_API_SECRET  || "D5hrAp4e0F55D5MdtIUh26RG26oK2Tzd3EqgORRqdaG";

// ── Token LiveKit ─────────────────────────────────────────────
app.get("/livekit-token", async (req, res) => {
  const { room = "intercom", identity } = req.query;
  if (!identity) return res.status(400).json({ error: "identity requerido" });
  const token = new AccessToken(LK_KEY, LK_SECRET, { identity, ttl: "8h" });
  token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  res.json({ token: await token.toJwt(), url: LK_URL });
});

// ── Estado global ─────────────────────────────────────────────
let tallyState = { inputs: {}, connectedBridge: false, lastUpdate: null };
// Nombres personalizados asignados por Realización: { "input1": "SERGIO" }
let customNames = {};
// Estado de emergencia
let emergencyActive = false;

app.get("/status", (req, res) => {
  res.send(`
    <h2>Tally Relay</h2>
    <p>Bridge: <b>${tallyState.connectedBridge ? "✅ Conectado" : "❌ Desconectado"}</b></p>
    <p>Clientes: <b>${io.sockets.sockets.size}</b></p>
    <p>Emergencia: <b>${emergencyActive ? "🟠 ACTIVA" : "—"}</b></p>
    <pre>${JSON.stringify(tallyState.inputs, null, 2)}</pre>
    <pre>Nombres: ${JSON.stringify(customNames, null, 2)}</pre>
    <p>Última actualización: ${tallyState.lastUpdate || "—"}</p>
  `);
});

// ── Socket.io ─────────────────────────────────────────────────
io.on("connection", (socket) => {
  const role   = socket.handshake.query.role;
  const secret = socket.handshake.query.secret;
  const BRIDGE_SECRET = process.env.BRIDGE_SECRET || "tally-estudio-2024";

  if (role === "bridge") {
    if (secret !== BRIDGE_SECRET) { socket.disconnect(); return; }
    console.log("✅ Bridge conectado");
    tallyState.connectedBridge = true;
    io.emit("bridge-status", { connected: true });

    socket.on("tally-update", (data) => {
      tallyState.inputs     = data.inputs;
      tallyState.lastUpdate = new Date().toISOString();
      socket.broadcast.emit("tally-update", data);
    });

    socket.on("disconnect", () => {
      tallyState.connectedBridge = false;
      tallyState.inputs = {};
      io.emit("bridge-status", { connected: false });
    });

  } else {
    // ── Cliente (smartphone / realización) ──
    // Enviar estado inicial
    socket.emit("tally-update",  { inputs: tallyState.inputs });
    socket.emit("bridge-status", { connected: tallyState.connectedBridge });
    socket.emit("names-update",  customNames);
    socket.emit("emergency",     { active: emergencyActive });

    // ── Realización: activar/desactivar emergencia ──
    socket.on("set-emergency", (data) => {
      emergencyActive = !!data.active;
      console.log(`🟠 Emergencia: ${emergencyActive ? "ACTIVADA" : "desactivada"}`);
      io.emit("emergency", { active: emergencyActive });
    });

    // ── Realización: renombrar una cámara/entrada ──
    socket.on("set-name", (data) => {
      // data = { input: "input1", name: "SERGIO" }
      if (!data || !data.input) return;
      const clean = (data.name || "").toString().slice(0, 10).toUpperCase().trim();
      if (clean) customNames[data.input] = clean;
      else delete customNames[data.input];
      console.log(`✏️  Nombre ${data.input} → ${clean || "(borrado)"}`);
      io.emit("names-update", customNames);
    });

    // ── Realización: expulsar a un participante ──
    socket.on("kick-user", (data) => {
      // data = { identity: "Cámara 3" }
      if (!data || !data.identity) return;
      console.log(`🚫 Expulsando a: ${data.identity}`);
      // Avisar a todos los clientes — el afectado se desconectará
      io.emit("kicked", { identity: data.identity });
    });

    socket.on("disconnect", () => {});
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
