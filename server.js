const WebSocket = require("ws");
const express = require("express");
const http = require("http");

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Set();

app.get("/", (req, res) => {
  res.json({ message: "WebSocket server is running" });
});

wss.on("connection", function connection(ws) {
  console.log("Client connected");
  clients.add(ws);

  ws.on("message", function incoming(message) {
    const parsedMessage = JSON.parse(message.toString());

    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(parsedMessage));
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected...");
    clients.delete(ws);
  });

  ws.send(JSON.stringify({ type: "welcome", message: "Connected to server" }));
});

server.listen(8080, () => {
  console.log("WebSocket server running at ws://localhost:8080");
});
