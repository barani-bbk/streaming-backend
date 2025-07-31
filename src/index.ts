import cors from "cors";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createWorker, createRouter } from "./sfu";
import { Peer } from "./peer";
import { Router, WebRtcTransport } from "mediasoup/node/lib/types";
import {
  startFfmpegForAudio,
  startFfmpegForHls,
  writeAudioSdpFile,
  writeMasterPlaylist,
  writeSdpFile,
} from "./hls";
import path from "path";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/live", express.static(path.join(__dirname, "public", "live")));

let router: Router;
const peers = new Map<string, Peer>();

async function startMediasoup() {
  const worker = await createWorker();
  router = await createRouter(worker);
}
startMediasoup();

async function createWebRtcTransport(): Promise<WebRtcTransport> {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: "127.0.0.1" }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
  console.log("Transport created:", transport.id);

  transport.on("dtlsstatechange", (state) => {
    if (state === "closed") transport.close();
  });
  transport.on("@close", () => console.log("Transport closed:", transport.id));
  return transport;
}

function informPeers(newProducerId: string, excludeSocketId: string) {
  console.log(`Informing peers about new producer: ${newProducerId}`);
  for (const [id, peer] of peers) {
    if (id !== excludeSocketId) {
      peer.emit("newProducer", { producerId: newProducerId });
    }
  }
}

async function createVideoPlainTransport() {
  const videoPlainTransport = await router.createPlainTransport({
    listenIp: "127.0.0.1",
    rtcpMux: false,
    comedia: false,
  });

  await videoPlainTransport.connect({
    ip: "127.0.0.1",
    port: 5004,
    rtcpPort: 5005,
  });

  return videoPlainTransport;
}

async function createAudioPlainTransport() {
  const audioPlainTransport = await router.createPlainTransport({
    listenIp: "127.0.0.1",
    rtcpMux: false,
    comedia: false,
  });
  await audioPlainTransport.connect({
    ip: "127.0.0.1",
    port: 5006,
    rtcpPort: 5007,
  });

  return audioPlainTransport;
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  const peer = new Peer(socket);
  peers.set(socket.id, peer);

  socket.emit("connectionSuccess", { socketId: socket.id });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    io.emit("peerLeft", { peerId: socket.id });
    peer.close();
    peers.delete(socket.id);
  });

  socket.on("joinRoom", (_, callback) => {
    console.log("joinRoom:", socket.id);
    callback({ rtpCapabilities: router.rtpCapabilities });
  });

  socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
    try {
      const transport = await createWebRtcTransport();
      if (consumer) peer.recvTransport = transport;
      else peer.sendTransport = transport;

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err) {
      console.error(err);
      callback({ error: "Failed to create transport" });
    }
  });

  socket.on("transportConnect", async ({ dtlsParameters }) => {
    try {
      await peer.sendTransport?.connect({ dtlsParameters });
    } catch (err) {
      console.error("transportConnect error:", err);
    }
  });

  socket.on("transportRecvConnect", async ({ dtlsParameters }) => {
    try {
      await peer.recvTransport?.connect({ dtlsParameters });
    } catch (err) {
      console.error("transportRecvConnect error:", err);
    }
  });

  socket.on("transportProduce", async ({ kind, rtpParameters }, callback) => {
    try {
      const producer = await peer.sendTransport?.produce({
        kind,
        rtpParameters,
      });
      if (!producer) return callback({ error: "Transport not ready" });

      peer.addProducer(producer);

      producer.on("transportclose", () => producer.close());

      producer.observer.on("pause", () => {
        io.emit("producerChange", {
          kind: producer.kind,
          peerId: socket.id,
          paused: true,
        });
      });

      producer.observer.on("resume", () => {
        io.emit("producerChange", {
          kind: producer.kind,
          peerId: socket.id,
          paused: false,
        });
      });

      if (producer.kind === "audio") {
        try {
          const plainAudioTransport = await createAudioPlainTransport();

          const audioConsumer = await plainAudioTransport.consume({
            producerId: producer.id,
            rtpCapabilities: router.rtpCapabilities,
            paused: false,
          });

          // Wait for SDP file to be written
          await writeAudioSdpFile(socket.id, audioConsumer.rtpParameters);

          const ffmpegProcess = startFfmpegForAudio(socket.id);

          // Store references for cleanup
          peer.plainAudioTransport = plainAudioTransport;
          peer.audioConsumer = audioConsumer;
          peer.audioProcess = ffmpegProcess;
        } catch (error) {
          console.error("❌ Error setting up audio HLS streaming:", error);
        }
      }

      if (producer.kind === "video") {
        try {
          const plainVideoTransport = await createVideoPlainTransport();

          const videoConsumer = await plainVideoTransport.consume({
            producerId: producer.id,
            rtpCapabilities: router.rtpCapabilities,
            paused: false,
          });

          // Wait for SDP file to be written
          await writeSdpFile(socket.id, videoConsumer.rtpParameters);

          const ffmpegProcess = startFfmpegForHls(socket.id);

          // Store references for cleanup
          peer.videoProcess = ffmpegProcess;
          peer.plainVideoTransport = plainVideoTransport;
          peer.videoConsumer = videoConsumer;
        } catch (error) {
          console.error("❌ Error setting up video HLS streaming:", error);
        }
      }

      if (peer.audioProcess && peer.videoProcess) {
        writeMasterPlaylist(peer.id);
      }

      informPeers(producer.id, socket.id);
      callback({ id: producer.id });
    } catch (err) {
      console.error("transportProduce error:", err);
      callback({ error: "Failed to produce" });
    }
  });

  socket.on(
    "consume",
    async ({ rtpCapabilities, remoteProducerId }, callback) => {
      try {
        if (
          !router.canConsume({ producerId: remoteProducerId, rtpCapabilities })
        )
          return callback({ params: { error: "Cannot consume" } });

        const consumer = await peer.recvTransport?.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true,
        });
        if (!consumer)
          return callback({ params: { error: "Failed to consume" } });

        peer.addConsumer(consumer);
        consumer.on("transportclose", () => consumer.close());
        consumer.on("producerclose", () => {
          consumer.close();
        });

        const remotePeer = [...peers.values()].find((p) =>
          p.producers.has(remoteProducerId)
        );
        if (!remotePeer)
          return callback({ params: { error: "Remote peer not found" } });

        callback({
          params: {
            id: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            serverConsumerId: consumer.id,
            remoteUserId: remotePeer.id,
          },
        });
      } catch (err: any) {
        console.error("consume error:", err.message);
        callback({ params: { error: err.message } });
      }
    }
  );

  socket.on("consumerResume", async ({ serverConsumerId }) => {
    const consumer = peer.consumers.get(serverConsumerId);
    if (consumer) await consumer.resume();
    else console.error("consumerResume: consumer not found");
  });

  socket.on("getProducers", (callback) => {
    const producerIds: string[] = [];
    for (const [id, otherPeer] of peers) {
      if (id !== socket.id) {
        for (const pid of otherPeer.producers.keys()) {
          producerIds.push(pid);
        }
      }
    }
    callback({ producers: producerIds });
  });

  socket.on("pauseProducer", async ({ kind }) => {
    const peer = peers.get(socket.id);
    if (!peer) return;
    for (const producer of peer.producers.values()) {
      if (producer.kind === kind) await producer.pause();
    }
  });

  socket.on("resumeProducer", async ({ kind }) => {
    const peer = peers.get(socket.id);
    if (!peer) return;
    for (const producer of peer.producers.values()) {
      if (producer.kind === kind) await producer.resume();
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
