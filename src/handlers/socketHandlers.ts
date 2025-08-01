import { Server, Socket } from "socket.io";
import { Peer } from "../models/Peer";
import { PeerManager } from "../services/PeerManager";
import { sseHandler } from "./sseHandler";
import { logger } from "../utils/Logger";
import { registerWebRtcHandlers } from "./webrtcHandler";

export function handleSocketConnection(
  io: Server,
  socket: Socket,
  peerManager: PeerManager
) {
  logger.info(`Client connected: ${socket.id}`);
  const peer = new Peer(socket);
  peerManager.add(peer);

  registerWebRtcHandlers(io, socket, peer, peerManager);

  socket.emit("connectionSuccess", { socketId: socket.id });

  socket.on("disconnect", () => {
    logger.info(`Client disconnected: ${socket.id}`);

    io.emit("peerLeft", { peerId: socket.id });

    if (peer.hlsService) {
      sseHandler.broadcast("peerLeft", { peerId: socket.id });
    }

    peerManager.remove(socket.id);
  });
}
