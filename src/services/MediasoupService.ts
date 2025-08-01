import * as mediasoup from "mediasoup";
import { Worker, Router, WebRtcTransport } from "mediasoup/node/lib/types";
import { mediasoupConfig } from "../config";
import { logger } from "../utils/Logger";
import { portManager } from "../utils/PortManager";

export class MediasoupService {
  private static instance: MediasoupService;
  private worker!: Worker;
  private router!: Router;

  private constructor() {}

  public static getInstance(): MediasoupService {
    if (!MediasoupService.instance) {
      MediasoupService.instance = new MediasoupService();
    }
    return MediasoupService.instance;
  }

  async start() {
    logger.info("Starting Mediasoup service...");
    this.worker = await mediasoup.createWorker(mediasoupConfig.worker);

    this.worker.on("died", () => {
      logger.error("Mediasoup Worker has died, exiting process.");
      process.exit(1);
    });

    this.router = await this.worker.createRouter(mediasoupConfig.router);
    logger.info("Mediasoup service started successfully.");
  }

  public getRouter(): Router {
    if (!this.router) {
      throw new Error("Mediasoup router not initialized. Call start() first.");
    }
    return this.router;
  }

  public async createWebRtcTransport(): Promise<WebRtcTransport> {
    const transport = await this.router.createWebRtcTransport(
      mediasoupConfig.webRtcTransport
    );

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        logger.info(`Transport closed for ${transport.id}`);
        transport.close();
      }
    });

    return transport;
  }

  public async createPlainTransport() {
    const router = MediasoupService.getInstance().getRouter();
    const port = await portManager.getAvailablePort();
    const rtcpPort = await portManager.getAvailablePort();

    const plainTransport = await router.createPlainTransport({
      ...mediasoupConfig.plainTransport,
    });

    await plainTransport.connect({
      ip: "127.0.0.1",
      port: port,
      rtcpPort: rtcpPort,
    });

    return { transport: plainTransport, port, rtcpPort };
  }
}
