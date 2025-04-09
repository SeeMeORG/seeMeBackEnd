const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// We'll store each client with extra state (available/busy, partner)
const clients = new Map(); // Map<WebSocket, { status: 'available' | 'busy', partner: WebSocket | null }>

wss.on("connection", function connection(ws) {
  console.log("Client connected");
  clients.set(ws, { status: "available", partner: null });

  ws.on("message", function incoming(message) {
    const parsedMessage = JSON.parse(message.toString());

    if (parsedMessage.type === "ready") {
      matchUser(ws);
    } else if (parsedMessage.type === "signal") {
      const partner = clients.get(ws)?.partner;
      if (partner && partner.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify({ type: "signal", signal: parsedMessage.signal }));
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected...");
    const { partner } = clients.get(ws) || {};
    if (partner && partner.readyState === WebSocket.OPEN) {
      partner.send(JSON.stringify({ type: "partner-disconnected" }));
      clients.set(partner, { status: "available", partner: null });
    }
    clients.delete(ws);
  });

  ws.send(JSON.stringify({ type: "welcome", message: "Connected to server" }));
});

function matchUser(ws) {
  const userInfo = clients.get(ws);
  if (!userInfo || userInfo.status !== "available") return;

  for (let [otherWs, otherInfo] of clients) {
    if (otherWs !== ws && otherInfo.status === "available") {
      // Match found
      clients.set(ws, { status: "busy", partner: otherWs });
      clients.set(otherWs, { status: "busy", partner: ws });

      // Notify both users to start signaling
      ws.send(JSON.stringify({ type: "ready" }));
      otherWs.send(JSON.stringify({ type: "ready" }));
      break;
    }
  }
}

server.listen(8080, () => {
  console.log("WebSocket server running at ws://localhost:8080");
});
