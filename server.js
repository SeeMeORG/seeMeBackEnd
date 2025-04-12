const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map(); // Map<id, ws>
const availableUsers = [];
const pairs = new Map(); // Map<id, partnerId>

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
    type: "users",
    total: clients.size,
    available: availableUsers.length,
  });

  for (const [, client] of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function tryPairUsers() {
  while (availableUsers.length >= 2) {
    const id1 = availableUsers.shift();
    const id2 = availableUsers.shift();

    const ws1 = clients.get(id1);
    const ws2 = clients.get(id2);

    if (
      ws1?.readyState === WebSocket.OPEN &&
      ws2?.readyState === WebSocket.OPEN
    ) {
      pairs.set(id1, id2);
      pairs.set(id2, id1);

      ws1.send(
        JSON.stringify({
          type: "start",
          initiator: true,
          target: id2,
        })
      );
      ws2.send(
        JSON.stringify({
          type: "start",
          initiator: false,
          target: id1,
        })
      );
    } else {
      if (ws1) availableUsers.push(id1);
      if (ws2) availableUsers.push(id2);
    }
  }

  broadcastUserCounts();
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
    } catch (e) {
      return;
    }

    if (data.type === "ready") {
      console.log(`User ready: ${id}`);

      if (!availableUsers.includes(id)) {
        availableUsers.push(id);
      }

      tryPairUsers();
    }

    if (data.type === "signal" && data.signal) {
      const partnerId = pairs.get(id);
      const partnerSocket = clients.get(partnerId);
      if (partnerSocket && partnerSocket.readyState === WebSocket.OPEN) {
        partnerSocket.send(
          JSON.stringify({
            type: "signal",
            signal: data.signal,
            from: id,
          })
        );
      }
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${id}`);
    clients.delete(id);

    const index = availableUsers.indexOf(id);
    if (index !== -1) {
      availableUsers.splice(index, 1);
    }

    const partnerId = pairs.get(id);
    if (partnerId) {
      pairs.delete(id);
      pairs.delete(partnerId);

      const partnerSocket = clients.get(partnerId);
      if (
        partnerSocket &&
        partnerSocket.readyState === WebSocket.OPEN
      ) {
        partnerSocket.send(
          JSON.stringify({ type: "partner_disconnected" })
        );

        if (!availableUsers.includes(partnerId)) {
          availableUsers.push(partnerId);
        }

        tryPairUsers(); // Try to reconnect this user
      }
    }

    broadcastUserCounts();
  });
});

server.listen(8080, () => {
  console.log("WebSocket server running at ws://localhost:8080");
});
