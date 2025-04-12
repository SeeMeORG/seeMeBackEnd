const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map(); // id -> ws
const availableUsers = new Set(); // Set of available user ids
const pairs = new Map(); // id -> partnerId

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.get("/", (req, res) => {
  res.json({ message: "WebSocket server is running" });
});

function broadcastUserCounts() {
  const payload = JSON.stringify({
    type: "updateUsers",
    total: clients.size,
    available: availableUsers.size,
  });

  for (const client of clients.values()) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function pairUsers(userAId, userBId) {
  const wsA = clients.get(userAId);
  const wsB = clients.get(userBId);

  if (!wsA || !wsB) return;

  // Clear any old pairing
  pairs.delete(userAId);
  pairs.delete(userBId);

  availableUsers.delete(userAId);
  availableUsers.delete(userBId);

  pairs.set(userAId, userBId);
  pairs.set(userBId, userAId);

  console.log(`Pairing users: ${userAId} <--> ${userBId}`);

  if (wsA.readyState === WebSocket.OPEN) {
    wsA.send(
      JSON.stringify({ type: "start", initiator: true, target: userBId })
    );
  }

  if (wsB.readyState === WebSocket.OPEN) {
    wsB.send(
      JSON.stringify({ type: "start", initiator: false, target: userAId })
    );
  }
}

function tryToPairUser(userId) {
  for (const otherId of availableUsers) {
    if (otherId !== userId) {
      pairUsers(userId, otherId);
      return true;
    }
  }
  return false;
}

wss.on("connection", (ws) => {
  const id = uuidv4();
  clients.set(id, ws);
  ws.id = id;

  console.log(`Client connected: ${id}`);
  ws.send(JSON.stringify({ type: "welcome", id }));
  broadcastUserCounts();

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    if (data.type === "ready") {
      console.log(`User ready: ${id}`);

      if (!clients.has(id)) return;

      if (!pairs.has(id)) {
        const paired = tryToPairUser(id);
        if (!paired) {
          availableUsers.add(id);
        }
      }

      broadcastUserCounts();
    }

    if (data.type === "signal" && data.signal) {
      const targetId = pairs.get(id);
      const targetSocket = clients.get(targetId);

      if (
        targetSocket &&
        targetSocket.readyState === WebSocket.OPEN &&
        pairs.get(targetId) === id // ensure valid pairing
      ) {
        targetSocket.send(
          JSON.stringify({ type: "signal", signal: data.signal, from: id })
        );
      }
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${id}`);
    clients.delete(id);
    availableUsers.delete(id);

    const partnerId = pairs.get(id);
    pairs.delete(id);

    if (partnerId) {
      pairs.delete(partnerId);
      const partnerSocket = clients.get(partnerId);

      if (partnerSocket && partnerSocket.readyState === WebSocket.OPEN) {
        availableUsers.add(partnerId);

        partnerSocket.send(JSON.stringify({ type: "partner_disconnected" }));

        // Delay re-pairing to give frontend time to reset
        setTimeout(() => {
          tryToPairUser(partnerId);
        }, 100);
      }
    }

    broadcastUserCounts();
  });
});

server.listen(8080, () => {
  console.log("WebSocket server running at ws://localhost:8080");
});
