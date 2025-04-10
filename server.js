const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map(); // id -> ws
const availableUsers = []; // queue of ready users
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

wss.on("connection", (ws) => {
  const id = uuidv4();
  clients.set(id, ws);
  ws.id = id;

  console.log(`Client connected: ${id}`);

  ws.send(JSON.stringify({ type: "welcome", id }));

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (e) {
      return;
    }

    if (data.type === "ready") {
      console.log(`User ready: ${id}`);
      if (availableUsers.length > 0) {
        const partnerId = availableUsers.shift();
        const partnerSocket = clients.get(partnerId);
        if (partnerSocket && partnerSocket.readyState === WebSocket.OPEN) {
          // Create the room (match both)
          pairs.set(id, partnerId);
          pairs.set(partnerId, id);

          // ✅ Assign roles
          // `id` is the initiator (second person to be ready)
          // `partnerId` is the responder

          ws.send(
            JSON.stringify({
              type: "start",
              initiator: true,
              target: partnerId,
            })
          );
          partnerSocket.send(
            JSON.stringify({ type: "start", initiator: false, target: id })
          );
        }
      } else {
        // Add self to waiting list
        availableUsers.push(id);
      }
    }

    // Route signal to matched peer
    if (data.type === "signal" && data.signal) {
      const targetId = pairs.get(id);
      const targetSocket = clients.get(targetId);
      if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
        targetSocket.send(
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
      const partnerSocket = clients.get(partnerId);
      if (partnerSocket && partnerSocket.readyState === WebSocket.OPEN) {
        partnerSocket.send(JSON.stringify({ type: "partner_disconnected" }));
      }
      pairs.delete(partnerId);
      pairs.delete(id);
    }
  });
});

server.listen(8080, () => {
  console.log("WebSocket server running at ws://localhost:8080");
});
