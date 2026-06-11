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
const LK_URL    = process.env.LIVEKIT_URL    || "wss://talliacom-6dqu9dpl.livekit.cloud";
const LK_KEY    = process.env.LIVEKIT_API_KEY    || "APIrPEUu7AF7BAC";
const LK_SECRET = process.env.LIVEKIT_API_SECRET || "D5hrAp4e0F55D5MdtIUh26RG26oK2Tzd3EqgORRqdaG";

// ── Endpoint: generar token LiveKit ──────────────────────────
// El cliente llama a /livekit-token?room=intercom&identity=CAM1
app.get("/livekit-token", async (req, res) => {
  const { room = "intercom", identity } = req.query;
  if (!identity) return res.status(400).json({ error: "identity requerido" });

  const token = new AccessToken(LK_KEY, LK_SECRET, {
    identity,
    ttl: "8h",
  });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
  });

  res.json({ token: await token.toJwt(), url: LK_URL });
});

// ── Estado tally ──────────────────────────────────────────────
let tallyState = { inputs: {}, connectedBridge: false, lastUpdate: null };

app.get("/status", (req, res) => {
  res.send(`
    <h2>Tally Relay</h2>
    <p>Bridge: <b>${tallyState.connectedBridge ? "✅ Conectado" : "❌ Desconectado"}</b></p>
    <p>Clientes: <b>${io.sockets.sockets.size}</b></p>
    <pre>${JSON.stringify(tallyState.inputs, null, 2)}</pre>
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
      tallyState.inputs    = data.inputs;
      tallyState.lastUpdate = new Date().toISOString();
      socket.broadcast.emit("tally-update", data);
    });

    socket.on("disconnect", () => {
      tallyState.connectedBridge = false;
      tallyState.inputs = {};
      io.emit("bridge-status", { connected: false });
    });

  } else {
    socket.emit("tally-update",  { inputs: tallyState.inputs });
    socket.emit("bridge-status", { connected: tallyState.connectedBridge });
    socket.on("disconnect", () => {});
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
