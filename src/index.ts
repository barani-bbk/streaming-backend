import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { serverConfig } from "./config";
import { PeerManager } from "./services/PeerManager";
import { MediasoupService } from "./services/MediasoupService";
import { sseHandler } from "./handlers/sseHandler";
import { logger } from "./utils/Logger";
import { handleSocketConnection } from "./handlers/socketHandlers";

async function main() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8,
  });

  app.use(cors());
  app.use(express.json());
  app.use("/live", express.static(serverConfig.liveDirectory));

  logger.info("Initializing services...");

  // Start Mediasoup
  const mediasoupService = MediasoupService.getInstance();
  await mediasoupService.start();

  // Initialize Peer Manager
  const peerManager = new PeerManager();

  // Initialize SSE Handler with the Peer Manager
  sseHandler.initialize(peerManager);

  // --- API Routes ---
  app.get("/api/live-streams", sseHandler.handleRequest.bind(sseHandler));

  // --- Socket.IO Connection Handling ---
  io.on("connection", (socket) => {
    handleSocketConnection(io, socket, peerManager);
  });

  server.listen(serverConfig.port, () => {
    logger.info(
      `Server is running on http://${serverConfig.listenIp}:${serverConfig.port}`
    );
  });
}

main().catch((err) => {
  logger.error("Fatal error during server startup:", err);
  process.exit(1);
});
