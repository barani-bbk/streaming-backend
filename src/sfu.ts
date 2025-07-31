import * as mediasoup from "mediasoup";

let worker;
let router;

export async function createWorker() {
  worker = await mediasoup.createWorker({
    logLevel: "warn",
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });

  console.log("✅ Mediasoup Worker created");

  worker.on("died", () => {
    console.error("❌ Mediasoup Worker died, exiting...");
    process.exit(1);
  });

  return worker;
}

const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

export async function createRouter(
  worker: mediasoup.types.Worker<mediasoup.types.AppData>
) {
  router = await worker.createRouter({ mediaCodecs });

  console.log("✅ Router created");
  return router;
}
