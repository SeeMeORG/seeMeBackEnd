const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = []; // { id, name, ws, available }
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

function getClientById(id) {
  return clients.find((c) => c.id === id);
}

function broadcastUserCounts() {
  const total = clients.length;
  const available = clients.filter((c) => c.available).length;

  const payload = JSON.stringify({
    type: "updateUsers",
    total,
    available,
    clients
  });

  for (const { ws } of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function pairUsers(userA, userB) {
  pairs.delete(userA.id);
  pairs.delete(userB.id);

  userA.available = false;
  userB.available = false;

  pairs.set(userA.id, userB.id);
  pairs.set(userB.id, userA.id);

  if (userA.ws.readyState === WebSocket.OPEN) {
    userA.ws.send(
      JSON.stringify({ type: "start", initiator: true, target: userB.id, targetName: userB?.name ?? "Anonymous" })
    );
  }

  if (userB.ws.readyState === WebSocket.OPEN) {
    userB.ws.send(
      JSON.stringify({ type: "start", initiator: false, target: userA.id, targetName: userA?.name ?? "Anonymous" })
    );
  }
}

function tryToPairUser(user) {
  const other = clients.find(
    (c) => c.id !== user.id && c.available && !pairs.has(c.id)
  );

  if (other) {
    pairUsers(user, other);
    return true;
  }

  user.available = true;
  return false;
}

wss.on("connection", (ws) => {
  const id = uuidv4();
  const client = { id, name: null, ws, available: false };
  clients.push(client);

  ws.send(JSON.stringify({ type: "welcome", id }));
  broadcastUserCounts();

  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    const current = getClientById(id);
    if (!current) return;

    if (data.type === "ready") {
      current.name = data.name || "Anonymous";
      if (!pairs.has(current.id)) {
        tryToPairUser(current);
      }
      broadcastUserCounts();
    }

    if (data.type === "signal" && data.signal) {
      const targetId = pairs.get(id);
      const target = getClientById(targetId);

      if (
        target &&
        target.ws.readyState === WebSocket.OPEN &&
        pairs.get(targetId) === id
      ) {
        target.ws.send(
          JSON.stringify({ type: "signal", signal: data.signal, from: id, participantName: "xxxx" })
        );
      }
    }
  });

  ws.on("close", () => {
    const index = clients.findIndex((c) => c.id === id);
    if (index !== -1) clients.splice(index, 1);

    const partnerId = pairs.get(id);
    pairs.delete(id);

    if (partnerId) {
      pairs.delete(partnerId);
      const partner = getClientById(partnerId);

      if (partner && partner.ws.readyState === WebSocket.OPEN) {
        partner.available = true;
        partner.ws.send(JSON.stringify({ type: "partner_disconnected" }));

        setTimeout(() => {
          tryToPairUser(partner);
        }, 100);
      }
    }

    broadcastUserCounts();
  });
});

server.listen(8080, () => {
  console.log("WebSocket server running...");
});
