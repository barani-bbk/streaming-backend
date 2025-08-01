import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import {
  Consumer,
  PlainTransport,
  RtpParameters,
} from "mediasoup/node/lib/types";
import path from "path";
import { serverConfig } from "../config";
import { logger } from "../utils/Logger";
import { MediasoupService } from "./MediasoupService";
import { portManager } from "../utils/PortManager";

export class HlsService {
  private peerId: string;
  private videoTransport: PlainTransport | null = null;
  private audioTransport: PlainTransport | null = null;
  private videoConsumer: Consumer | null = null;
  private audioConsumer: Consumer | null = null;
  private videoProcess: ChildProcess | null = null;
  private audioProcess: ChildProcess | null = null;
  private usedPorts: number[] = [];

  constructor(peerId: string) {
    this.peerId = peerId;
    if (!fs.existsSync(serverConfig.liveDirectory)) {
      fs.mkdirSync(serverConfig.liveDirectory, { recursive: true });
    }
  }

  public async start(
    videoProducerId: string,
    audioProducerId: string
  ): Promise<void> {
    logger.info(`[${this.peerId}] Starting HLS service...`);
    const mediasoupService = MediasoupService.getInstance();
    const router = mediasoupService.getRouter();

    const {
      transport: videoTransport,
      port: videoPort,
      rtcpPort: videoRtcpPort,
    } = await mediasoupService.createPlainTransport();

    this.videoTransport = videoTransport;
    this.usedPorts.push(videoPort, videoRtcpPort);

    this.videoConsumer = await this.videoTransport.consume({
      producerId: videoProducerId,
      rtpCapabilities: router.rtpCapabilities,
      paused: true,
    });

    const videoSdp = this.createSdp(
      this.videoConsumer.rtpParameters,
      videoPort,
      videoRtcpPort
    );
    this.writeSdpFile(`${this.peerId}-video.sdp`, videoSdp);
    this.videoProcess = this.startFfmpegVideo();

    // Set up audio stream
    const {
      transport: audioTransport,
      port: audioPort,
      rtcpPort: audioRtcpPort,
    } = await mediasoupService.createPlainTransport();

    this.audioTransport = audioTransport;
    this.usedPorts.push(audioPort, audioRtcpPort);

    this.audioConsumer = await this.audioTransport.consume({
      producerId: audioProducerId,
      rtpCapabilities: router.rtpCapabilities,
      paused: true,
    });

    const audioSdp = this.createSdp(
      this.audioConsumer.rtpParameters,
      audioPort,
      audioRtcpPort
    );
    this.writeSdpFile(`${this.peerId}-audio.sdp`, audioSdp);
    this.audioProcess = this.startFfmpegAudio();

    await this.videoConsumer.resume();
    await this.audioConsumer.resume();
  }

  public writeMasterPlaylist(): void {
    const videoPlaylist = `${this.peerId}-video.m3u8`;
    const audioPlaylist = `${this.peerId}-audio.m3u8`;

    const content = `#EXTM3U
    #EXT-X-VERSION:3
    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="${audioPlaylist}"
    #EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.42e01e,mp4a.40.2",AUDIO="audio"
    ${videoPlaylist}
`;

    const masterPath = path.join(
      serverConfig.liveDirectory,
      `${this.peerId}.m3u8`
    );
    fs.writeFileSync(masterPath, content);
    logger.info(`[${this.peerId}] Master HLS playlist written: ${masterPath}`);
  }

  public cleanup(): void {
    logger.warn(`[${this.peerId}] Cleaning up HLS resources.`);

    if (this.videoProcess) this.videoProcess.kill("SIGINT");
    if (this.audioProcess) this.audioProcess.kill("SIGINT");

    this.videoProcess = null;
    this.audioProcess = null;

    this.videoConsumer?.close();
    this.audioConsumer?.close();
    this.videoTransport?.close();
    this.audioTransport?.close();

    this.usedPorts.forEach((port) => portManager.releasePort(port));
    this.usedPorts = [];

    setTimeout(() => {
      fs.readdir(serverConfig.liveDirectory, (err, files) => {
        if (err) {
          logger.error(`[${this.peerId}] Error reading HLS directory:`, err);
          return;
        }

        files.forEach((file) => {
          if (file.includes(this.peerId)) {
            fs.unlink(path.join(serverConfig.liveDirectory, file), (err) => {
              if (err) {
                logger.error(
                  `[${this.peerId}] Error deleting HLS file: ${file}`,
                  err
                );
              } else {
                logger.debug(`[${this.peerId}] Deleted HLS file: ${file}`);
              }
            });
          }
        });
      });
    }, 15000);
  }

  private writeSdpFile(filename: string, sdpContent: string) {
    const sdpPath = path.join(serverConfig.liveDirectory, filename);
    fs.writeFileSync(sdpPath, sdpContent);
    logger.debug(`[${this.peerId}] SDP file written to ${sdpPath}`);
  }

  private createSdp(
    rtpParameters: RtpParameters,
    port: number,
    rtcpPort: number
  ): string {
    const codec = rtpParameters.codecs[0];
    const payloadType = codec.payloadType;
    const codecName = codec.mimeType.split("/")[1];
    const clockRate = codec.clockRate;

    let frameRateAttr = "";
    if (codec.parameters && codec.parameters.framerate) {
      frameRateAttr = `\na=framerate:${codec.parameters.framerate}`;
    }

    const isVideo = codec.mimeType.toLowerCase().startsWith("video");

    const type = isVideo ? "video" : "audio";
    const channels = codec.channels || 2;

    const sdp = `v=0
    o=- 0 0 IN IP4 127.0.0.1
    s=Mediasoup RTP Video
    c=IN IP4 127.0.0.1
    t=0 0
    m=${type} ${port} RTP/AVP ${payloadType}
    a=rtpmap:${payloadType} ${codecName}/${clockRate}${
      !isVideo ? `/${channels}` : ""
    }
    a=recvonly
    a=rtcp:${rtcpPort} IN IP4 127.0.0.1${frameRateAttr}`;

    return sdp;
  }

  private startFfmpegVideo(): ChildProcess {
    const sdpPath = path.join(
      serverConfig.liveDirectory,
      `${this.peerId}-video.sdp`
    );
    const outputPath = path.join(
      serverConfig.liveDirectory,
      `${this.peerId}-video.m3u8`
    );

    const args = [
      "-protocol_whitelist",
      "file,udp,rtp",
      "-fflags",
      "+genpts+igndts",
      "-avoid_negative_ts",
      "make_zero",
      "-f",
      "sdp",
      "-i",
      sdpPath,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-profile:v",
      "baseline",
      "-g",
      "15",
      "-keyint_min",
      "15",
      "-sc_threshold",
      "0",
      "-r",
      "15",
      "-max_muxing_queue_size",
      "1024",
      "-an",
      "-f",
      "hls",
      "-hls_time",
      "1",
      "-hls_list_size",
      "3",
      "-hls_flags",
      "delete_segments+independent_segments",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      path.join(serverConfig.liveDirectory, `video_${this.peerId}_%03d.ts`),
      "-force_key_frames",
      "expr:gte(t,n_forced*1)",
      outputPath,
    ];

    logger.info(`[${this.peerId}] Spawning FFmpeg for video...`);
    const ffmpeg = spawn("ffmpeg", args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });
    this.handleFfmpegEvents(ffmpeg, "Video");
    return ffmpeg;
  }

  private startFfmpegAudio(): ChildProcess {
    const sdpPath = path.join(
      serverConfig.liveDirectory,
      `${this.peerId}-audio.sdp`
    );
    const outputPath = path.join(
      serverConfig.liveDirectory,
      `${this.peerId}-audio.m3u8`
    );

    const args = [
      "-protocol_whitelist",
      "file,udp,rtp",
      "-f",
      "sdp",
      "-i",
      sdpPath,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "hls",
      "-hls_time",
      "2",
      "-hls_list_size",
      "5",
      "-hls_flags",
      "delete_segments",
      "-hls_segment_filename",
      path.join(serverConfig.liveDirectory, `audio_${this.peerId}_%03d.ts`),
      outputPath,
    ];

    logger.info(`[${this.peerId}] Spawning FFmpeg for audio...`);
    const ffmpeg = spawn("ffmpeg", args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });
    this.handleFfmpegEvents(ffmpeg, "Audio");
    return ffmpeg;
  }

  private handleFfmpegEvents(ffmpeg: ChildProcess, type: "Video" | "Audio") {
    ffmpeg.on("error", (err) => {
      logger.error(`[${this.peerId}] FFmpeg ${type} process error:`, err);
    });

    ffmpeg.on("exit", (code, signal) => {
      logger.warn(
        `[${this.peerId}] FFmpeg ${type} process exited with code ${code}, signal ${signal}`
      );
    });

    ffmpeg.stdout?.on("data", (data) =>
      logger.ffmpeg(`[${type}] ${data.toString().trim()}`)
    );
    ffmpeg.stderr?.on("data", (data) =>
      logger.ffmpeg(`[${type}] [STDERR] ${data.toString().trim()}`)
    );
  }
}
