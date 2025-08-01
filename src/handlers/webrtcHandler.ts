import { Server, Socket } from "socket.io";
import { Peer } from "../models/Peer";
import { PeerManager } from "../services/PeerManager";
import { MediasoupService } from "../services/MediasoupService";
import { HlsService } from "../services/HlsService";
import { sseHandler } from "./sseHandler";
import { logger } from "../utils/Logger";
import { types } from "mediasoup";

export function registerWebRtcHandlers(
  io: Server,
  socket: Socket,
  peer: Peer,
  peerManager: PeerManager
) {
  const mediasoupService = MediasoupService.getInstance();
  const router = mediasoupService.getRouter();

  socket.on("getRouterRtpCapabilities", (_, callback) => {
    callback({ rtpCapabilities: router.rtpCapabilities });
  });

  socket.on("createWebRtcTransport", async ({ isConsumer }, callback) => {
    try {
      const transport = await mediasoupService.createWebRtcTransport();
      if (isConsumer) {
        peer.recvTransport = transport;
      } else {
        peer.sendTransport = transport;
      }
      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err) {
      logger.error(`[${peer.id}] Failed to create WebRTC transport:`, err);
      callback({ error: (err as Error).message });
    }
  });

  socket.on(
    "connectTransport",
    async ({ transportId, dtlsParameters }, callback) => {
      try {
        const transport =
          transportId === peer.sendTransport?.id
            ? peer.sendTransport
            : peer.recvTransport;
        if (!transport)
          throw new Error(
            `Transport ${transportId} not found for peer ${peer.id}`
          );

        await transport.connect({ dtlsParameters });
        callback({ connected: true });
      } catch (err) {
        logger.error(
          `[${peer.id}] Failed to connect transport ${transportId}:`,
          err
        );
        callback({ error: (err as Error).message });
      }
    }
  );

  socket.on(
    "transportProduce",
    async (
      {
        kind,
        rtpParameters,
      }: { kind: types.MediaKind; rtpParameters: types.RtpParameters },
      callback
    ) => {
      try {
        if (!peer.sendTransport)
          throw new Error("Send transport not initialized");
        const producer = await peer.sendTransport.produce({
          kind,
          rtpParameters,
        });
        peer.addProducer(producer);

        producer.on("transportclose", () => {
          logger.info(`Producer's transport closed: ${producer.id}`);
          producer.close();
        });

        producer.observer.on("pause", () => {
          logger.info(`Producer paused: ${producer.id} for peer ${peer.id}`);
          io.emit("producerChange", {
            kind: producer.kind,
            peerId: socket.id,
            paused: true,
          });
        });

        producer.observer.on("resume", () => {
          logger.info(`Producer resumed: ${producer.id} for peer ${peer.id}`);
          io.emit("producerChange", {
            kind: producer.kind,
            peerId: socket.id,
            paused: false,
          });
        });

        peerManager.getOtherPeers(peer.id).forEach((p) => {
          p.emit("newProducer", {
            producerId: producer.id,
            producerSocketId: peer.id,
          });
        });

        // Check if HLS can be started
        const videoProducer = peer.getProducersByKind("video");
        const audioProducer = peer.getProducersByKind("audio");
        if (videoProducer && audioProducer && !peer.hlsService) {
          logger.info(
            `[${peer.id}] Both audio and video producers are available. Starting HLS.`
          );
          peer.hlsService = new HlsService(peer.id);
          await peer.hlsService.start(videoProducer.id, audioProducer.id);

          setTimeout(() => {
            peer.hlsService?.writeMasterPlaylist();
            sseHandler.broadcast("peerLive", { peerId: peer.id });
          }, 5000);
        }

        callback({ id: producer.id });
      } catch (err) {
        logger.error(`[${peer.id}] Failed to produce:`, err);
        callback({ error: (err as Error).message });
      }
    }
  );

  socket.on(
    "transportConsume",
    async ({ rtpCapabilities, remoteProducerId }, callback) => {
      try {
        if (!peer.recvTransport)
          throw new Error("Receive transport not initialized");
        if (
          !router.canConsume({ producerId: remoteProducerId, rtpCapabilities })
        ) {
          throw new Error("Cannot consume this producer");
        }
        const consumer = await peer.recvTransport.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true,
        });
        peer.addConsumer(consumer);

        callback({
          id: consumer.id,
          producerId: remoteProducerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (err) {
        logger.error(
          `[${peer.id}] Failed to consume producer ${remoteProducerId}:`,
          err
        );
        callback({ error: (err as Error).message });
      }
    }
  );

  socket.on("resumeConsumer", async ({ consumerId }) => {
    try {
      const consumer = peer.getConsumer(consumerId);
      if (!consumer) throw new Error(`Consumer ${consumerId} not found`);
      await consumer.resume();
    } catch (err) {
      logger.error(
        `[${peer.id}] Failed to resume consumer ${consumerId}:`,
        err
      );
    }
  });

  socket.on("getProducers", (callback) => {
    const producers = peerManager.getOtherPeers(peer.id).flatMap((p) =>
      Array.from(p.getProducers().entries()).map(([producerId]) => ({
        peerId: p.id,
        producerId,
      }))
    );
    callback({ producers });
  });

  socket.on("pauseProducer", async ({ kind }: { kind: types.MediaKind }) => {
    logger.info(`[${peer.id}] Received pauseProducer for kind: ${kind}`);
    const producer = peer.getProducersByKind(kind);
    if (producer) {
      await producer.pause();
    } else {
      logger.warn(`[${peer.id}] Producer of kind ${kind} not found to pause.`);
    }
  });

  socket.on("resumeProducer", async ({ kind }: { kind: types.MediaKind }) => {
    logger.info(`[${peer.id}] Received resumeProducer for kind: ${kind}`);
    const producer = peer.getProducersByKind(kind);
    if (producer) {
      await producer.resume();
    } else {
      logger.warn(`[${peer.id}] Producer of kind ${kind} not found to resume.`);
    }
  });
}
