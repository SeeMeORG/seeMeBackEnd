const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = [];
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

const getClientById = (id) => {
  return clients.find((c) => c.id === id);
};

const broadcastUserCounts = () => {
  const total = clients.length;
  const available = clients.filter((c) => c.available).length;

  const payload = JSON.stringify({
    type: "updateUsers",
    total,
    available,
    clients,
  });

  for (const { ws } of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
};

const pairUsers = (userA, userB) => {
  if (!userA || !userB) return;
  if (userA.id === userB.id) return;

  const aPartner = pairs.get(userA.id);
  const bPartner = pairs.get(userB.id);

  if (aPartner) {
    pairs.delete(aPartner);
    pairs.delete(userA.id);
  }
  if (bPartner) {
    pairs.delete(bPartner);
    pairs.delete(userB.id);
  }

  userA.available = false;
  userB.available = false;

  userA.lastPartnerId = userB.id;
  userB.lastPartnerId = userA.id;

  pairs.set(userA.id, userB.id);
  pairs.set(userB.id, userA.id);

  if (userA.ws.readyState === WebSocket.OPEN) {
    userA.ws.send(
      JSON.stringify({
        type: "start",
        initiator: true,
        target: userB.id,
        targetName: userB?.name ?? "Anonymous",
      })
    );
  }

  if (userB.ws.readyState === WebSocket.OPEN) {
    userB.ws.send(
      JSON.stringify({
        type: "start",
        initiator: false,
        target: userA.id,
        targetName: userA?.name ?? "Anonymous",
      })
    );
  }
};

const tryToPairUser = (user) => {
  if (!user || !user.available) return false;

  user.available = false;

  const availableOthers = clients.filter((c) => {
    if (c.id === user.id) return false;
    if (!c.available) return false;
    if (pairs.has(c.id)) return false;
    if (c.id === user.lastPartnerId) return false;
    return true;
  });

  if (availableOthers.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableOthers.length);
    const other = availableOthers[randomIndex];

    if (pairs.has(user.id) || pairs.has(other.id)) {
      console.warn("Pairing race condition avoided");
      return false;
    }

    pairUsers(user, other);
    return true;
  }

  const fallback = clients.find((c) => {
    return c.id !== user.id && c.available && !pairs.has(c.id);
  });

  if (fallback) {
    pairUsers(user, fallback);
    return true;
  }

  user.available = true;
  return false;
};

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

      const oldPartnerId = pairs.get(current.id);
      if (oldPartnerId) {
        pairs.delete(oldPartnerId);
        pairs.delete(current.id);
      }

      current.available = true;

      tryToPairUser(current);
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
          JSON.stringify({
            type: "signal",
            signal: data.signal,
            from: id,
          })
        );
      }
    }

    if (data.type === "next") {
      const oldPartnerId = pairs.get(current.id);

      if (oldPartnerId) {
        const partner = getClientById(oldPartnerId);

        pairs.delete(current.id);
        pairs.delete(oldPartnerId);

        if (partner && partner.ws.readyState === WebSocket.OPEN) {
          partner.available = true;
          partner.ws.send(JSON.stringify({ type: "partner_disconnected" }));

          setTimeout(() => {
            tryToPairUser(partner);
            broadcastUserCounts();
          }, 100);
        }
      }

      current.available = true;
      current.ws.send(JSON.stringify({ type: "partner_disconnected" }));

      setTimeout(() => {
        tryToPairUser(current);
        broadcastUserCounts();
      }, 100);
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
