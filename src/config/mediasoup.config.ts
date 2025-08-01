import {
  PlainTransportOptions,
  RtpCodecCapability,
  WebRtcTransportOptions,
  WorkerSettings,
} from "mediasoup/node/lib/types";

interface MediasoupConfig {
  worker: WorkerSettings;
  router: {
    mediaCodecs: RtpCodecCapability[];
  };
  webRtcTransport: WebRtcTransportOptions;
  plainTransport: PlainTransportOptions;
}

export const mediasoupConfig: MediasoupConfig = {
  worker: {
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
    logLevel: "warn",
  },

  router: {
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: "video",
        mimeType: "video/H264",
        clockRate: 90000,
        parameters: {
          "packetization-mode": 1,
          "profile-level-id": "42e01f",
          "level-asymmetry-allowed": 1,
          "x-google-start-bitrate": 1000,
        },
      },
    ] as RtpCodecCapability[],
  },

  webRtcTransport: {
    listenIps: [{ ip: "127.0.0.1" }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  },
  plainTransport: {
    listenIp: "127.0.0.1",
    rtcpMux: false,
    comedia: false,
  },
};
