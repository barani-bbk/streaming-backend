import { Request, Response } from "express";
import { PeerManager } from "../services/PeerManager";
import { logger } from "../utils/Logger";

type SseClient = (event: string, data: any) => void;

class SseHandler {
  private clients = new Set<SseClient>();
  private peerManager: PeerManager | null = null;

  public initialize(peerManager: PeerManager) {
    this.peerManager = peerManager;
  }

  public handleRequest(req: Request, res: Response): void {
    if (!this.peerManager) {
      throw new Error("SseHandler not initialized. Call initialize() first.");
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send: SseClient = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    this.clients.add(send);
    logger.info(`SSE client connected. Total clients: ${this.clients.size}`);

    const livePeers = this.peerManager
      .getAllPeers()
      .filter((p) => p.hlsService !== null)
      .map((p) => ({ peerId: p.id }));
    send("init", { livePeers });

    req.on("close", () => {
      this.clients.delete(send);
      logger.info(
        `SSE client disconnected. Total clients: ${this.clients.size}`
      );
    });
  }

  public broadcast(event: string, data: any): void {
    logger.debug(
      `Broadcasting SSE event '${event}' to ${this.clients.size} clients.`
    );
    for (const client of this.clients) {
      client(event, data);
    }
  }
}

export const sseHandler = new SseHandler();
