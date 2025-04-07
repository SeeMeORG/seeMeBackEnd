const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8080 });
const clients = new Set();

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
    console.log("Client disconnected");
    clients.delete(ws);
  });

  ws.send(JSON.stringify({ type: "welcome", message: "Connected to server" }));
});

console.log("WebSocket server running at ws://localhost:8080");
