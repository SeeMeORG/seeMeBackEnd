const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();
const availableUsers = [];
const pairs = new Map();

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
    available: availableUsers.length,
  });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
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
      if (availableUsers.length > 0) {
        const partnerId = availableUsers.shift();
        const partnerSocket = clients.get(partnerId);

        if (partnerSocket && partnerSocket.readyState === WebSocket.OPEN) {
          pairs.set(id, partnerId);
          pairs.set(partnerId, id);

          ws.send(JSON.stringify({ type: "start", initiator: true, target: partnerId }));
          partnerSocket.send(JSON.stringify({ type: "start", initiator: false, target: id }));
        } else {
          availableUsers.push(id);
        }
      } else {
        availableUsers.push(id);
      }

      broadcastUserCounts();
    }

    if (data.type === "signal" && data.signal) {
      const targetId = pairs.get(id);
      const targetSocket = clients.get(targetId);
      if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
        targetSocket.send(JSON.stringify({ type: "signal", signal: data.signal, from: id }));
      }
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected: ${id}`);
    clients.delete(id);
    const index = availableUsers.indexOf(id);
    if (index !== -1) availableUsers.splice(index, 1);

    const partnerId = pairs.get(id);
    if (partnerId) {
      pairs.delete(id);
      pairs.delete(partnerId);
      const partnerSocket = clients.get(partnerId);

      if (partnerSocket && partnerSocket.readyState === WebSocket.OPEN) {
        availableUsers.push(partnerId); // Put partner back into queue
        partnerSocket.send(JSON.stringify({ type: "partner_disconnected" }));
      }
    }

    broadcastUserCounts();
  });
});

server.listen(8080, () => {
  console.log("WebSocket server running at ws://localhost:8080");
});
