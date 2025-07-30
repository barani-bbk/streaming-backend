import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());

const peers = new Map<string, { socket: Socket }>();

io.on("connection", (socket) => {
  console.log("🧠 New client connected:", socket.id);

  peers.set(socket.id, {
    socket,
  });

  console.log("🧠 Connected peers:", peers.size);

  console.log("Peers:", peers);

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);

    peers.delete(socket.id);
  });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
