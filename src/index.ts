import cors from "cors";
import express from "express";
import http from "http";
import { Router, WebRtcTransport } from "mediasoup/node/lib/types";
import path from "path";
import { Server } from "socket.io";
import {
  startFfmpegForAudio,
  startFfmpegForHls,
  writeAudioSdpFile,
  writeMasterPlaylist,
  writeSdpFile,
} from "./hls";
import { Peer } from "./peer";
import { portManager } from "./portManager";
import { createRouter, createWorker } from "./sfu";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/live", express.static(path.join(__dirname, "public", "live")));

let router: Router;
const peers = new Map<string, Peer>();
const sseClients = new Set<(event: string, data: any) => void>();

function broadcastSSE(event: string, data: any) {
  for (const send of sseClients) {
    send(event, data);
  }
}

app.get("/api/live-streams", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sseClients.add(send);

  const livePeers = Array.from(peers.values()).map((peer) => ({
    peerId: peer.id,
  }));
  send("init", { livePeers });

  req.on("close", () => {
    sseClients.delete(send);
  });
});

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

async function createPlainTransport() {
  const port = await portManager.getAvailablePort();
  const rtcpPort = await portManager.getAvailablePort();

  const plainTransport = await router.createPlainTransport({
    listenIp: "127.0.0.1",
    rtcpMux: false,
    comedia: false,
  });

  await plainTransport.connect({
    ip: "127.0.0.1",
    port: port,
    rtcpPort: rtcpPort,
  });

  return { plainTransport, port, rtcpPort };
}

async function startHlsForPeer(
  peer: Peer,
  videoProducerId: string,
  audioProducerId: string
) {
  const {
    plainTransport: videoTransport,
    port: videoPort,
    rtcpPort: videoRtcpPort,
  } = await createPlainTransport();
  peer.plainVideoTransport = videoTransport;

  const {
    plainTransport: audioTransport,
    port: audioPort,
    rtcpPort: audioRtcpPort,
  } = await createPlainTransport();
  peer.plainAudioTransport = audioTransport;

  const videoConsumer = await peer.plainVideoTransport.consume({
    producerId: videoProducerId,
    rtpCapabilities: router.rtpCapabilities,
    paused: false,
  });

  const audioConsumer = await peer.plainAudioTransport.consume({
    producerId: audioProducerId,
    rtpCapabilities: router.rtpCapabilities,
    paused: false,
  });

  peer.videoConsumer = videoConsumer;
  peer.audioConsumer = audioConsumer;

  await writeSdpFile(
    peer.id,
    videoConsumer.rtpParameters,
    videoPort,
    videoRtcpPort
  );
  await writeAudioSdpFile(
    peer.id,
    audioConsumer.rtpParameters,
    audioPort,
    audioRtcpPort
  );

  peer.videoProcess = startFfmpegForHls(peer.id);
  peer.audioProcess = startFfmpegForAudio(peer.id);

  setTimeout(() => {
    writeMasterPlaylist(peer.id);
    broadcastSSE("peerLive", { peerId: peer.id });
  }, 3000);
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
    broadcastSSE("peerLeft", { peerId: socket.id });
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

      if (
        peer.producers.size === 2 &&
        !peer.videoProcess &&
        !peer.audioProcess
      ) {
        let videoProducerId;
        let audioProducerId;

        peer.producers.forEach((producer) => {
          if (producer.kind === "video") {
            videoProducerId = producer.id;
          }
          if (producer.kind === "audio") {
            audioProducerId = producer.id;
          }
        });
        if (!videoProducerId || !audioProducerId) return;
        startHlsForPeer(peer, videoProducerId, audioProducerId);
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
