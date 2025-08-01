import { spawn } from "child_process";
import fs from "fs";
import { RtpParameters } from "mediasoup/node/lib/rtpParametersTypes";
import path from "path";

const liveFolder = path.join(__dirname, "public", "live");

const getVideoPlaylistName = (peerId: string) => `${peerId}-video.m3u8`;
const getAudioPlaylistName = (peerId: string) => `${peerId}-audio.m3u8`;

function getSDPPath(peerId: string) {
  return path.join(liveFolder, `${peerId}-video.sdp`);
}

function getAudioSDPPath(peerId: string) {
  return path.join(liveFolder, `${peerId}-audio.sdp`);
}

export function startFfmpegForHls(peerId: string) {
  const outputPath = path.join(liveFolder, getVideoPlaylistName(peerId));
  const sdpPath = getSDPPath(peerId);

  if (!fs.existsSync(sdpPath)) {
    console.error("❌ Video SDP file not found:", sdpPath);
    return null;
  }

  const args = [
    "-protocol_whitelist",
    "file,udp,rtp",

    // Input buffer settings for better RTP handling
    "-fflags",
    "+genpts+igndts",
    "-avoid_negative_ts",
    "make_zero",

    "-f",
    "sdp",
    "-i",
    sdpPath,

    // Video codec settings optimized for speed
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast", // Changed from "veryfast" for maximum speed
    "-tune",
    "zerolatency",
    "-profile:v",
    "baseline", // Simpler profile for faster encoding

    // Reduced GOP size for faster segment creation
    "-g",
    "15", // Reduced from 30 - keyframe every 15 frames
    "-keyint_min",
    "15",
    "-sc_threshold",
    "0",

    // Frame rate control
    "-r",
    "15", // Limit to 15fps for faster processing
    "-max_muxing_queue_size",
    "1024",

    // Resolution scaling for performance (optional)
    // "-vf", "scale=640:360", // Uncomment to downscale

    // Audio handling (disable if not needed)
    "-an", // No audio for faster processing

    // HLS options optimized for low latency
    "-f",
    "hls",
    "-hls_time",
    "1", // Reduced from 2 seconds for faster segment creation
    "-hls_list_size",
    "3", // Reduced playlist size
    "-hls_flags",
    "delete_segments+independent_segments",
    "-hls_segment_type",
    "mpegts",
    "-hls_segment_filename",
    path.join(liveFolder, `video_${peerId}_%03d.ts`),

    // Force segment creation
    "-force_key_frames",
    "expr:gte(t,n_forced*1)", // Force keyframe every 1 second

    outputPath,
  ];

  console.log("🎥 Starting FFmpeg for video:", peerId);
  console.log("🔧 FFmpeg args:", args.join(" "));

  const ffmpeg = spawn("ffmpeg", args, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  // Enhanced logging
  ffmpeg.stdout.on("data", (data) => {
    const output = data.toString();
    console.log(`FFmpeg Video stdout: ${output.trim()}`);
  });

  ffmpeg.stderr.on("data", (data) => {
    const output = data.toString();
    console.log(`FFmpeg Video stderr: ${output.trim()}`);
  });

  ffmpeg.on("error", (error) => {
    console.error("❌ FFmpeg Video error:", error);
  });

  ffmpeg.on("exit", (code, signal) => {
    console.log(`🔴 FFmpeg Video exited with code ${code} signal ${signal}`);
  });

  return ffmpeg;
}

export function startFfmpegForAudio(peerId: string) {
  const outputPath = path.join(liveFolder, getAudioPlaylistName(peerId));
  const sdpPath = getAudioSDPPath(peerId);

  // Check if SDP file exists
  if (!fs.existsSync(sdpPath)) {
    console.error("❌ Audio SDP file not found:", sdpPath);
    return null;
  }

  const args = [
    "-protocol_whitelist",
    "file,udp,rtp",
    "-f",
    "sdp",
    "-i",
    sdpPath,

    // Audio codec & settings
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000", // Sample rate
    "-ac",
    "2", // Channels

    // HLS settings
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "5",
    "-hls_flags",
    "delete_segments",
    "-hls_segment_filename",
    path.join(liveFolder, `audio_${peerId}_%03d.ts`),
    outputPath,
  ];

  console.log("🎵 Starting FFmpeg for audio:", peerId);
  const ffmpeg = spawn("ffmpeg", args, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  // Log output for debugging
  ffmpeg.stdout.on("data", (data) => {
    console.log(`FFmpeg Audio stdout: ${data}`);
  });

  ffmpeg.stderr.on("data", (data) => {
    console.log(`FFmpeg Audio stderr: ${data}`);
  });

  ffmpeg.on("error", (error) => {
    console.error("❌ FFmpeg Audio error:", error);
  });

  ffmpeg.on("exit", (code, signal) => {
    console.log(`🔴 FFmpeg Audio exited with code ${code} signal ${signal}`);
  });

  return ffmpeg;
}

export function generateSdp(
  rtpParameters: RtpParameters,
  port: number,
  rtcpPort: number
) {
  const codec = rtpParameters.codecs[0];
  const payloadType = codec.payloadType;
  const codecName = codec.mimeType.split("/")[1];
  const clockRate = codec.clockRate;

  // Add frame rate information if available
  let frameRateAttr = "";
  if (codec.parameters && codec.parameters.framerate) {
    frameRateAttr = `\na=framerate:${codec.parameters.framerate}`;
  }

  const sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Mediasoup RTP Video
c=IN IP4 127.0.0.1
t=0 0
m=video ${port} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${codecName}/${clockRate}
a=recvonly
a=rtcp:${rtcpPort} IN IP4 127.0.0.1${frameRateAttr}`;

  return sdp;
}

export function generateAudioSdp(
  rtpParameters: RtpParameters,
  port: number,
  rtcpPort: number
) {
  const codec = rtpParameters.codecs[0];
  const payloadType = codec.payloadType;
  const codecName = codec.mimeType.split("/")[1];
  const clockRate = codec.clockRate;

  const channels = codec.channels || 2;

  const audioSdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Mediasoup RTP Audio
c=IN IP4 127.0.0.1
t=0 0
m=audio ${port} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${codecName}/${clockRate}/${channels}
a=recvonly
a=rtcp:${rtcpPort} IN IP4 127.0.0.1`;

  return audioSdp;
}

export async function writeAudioSdpFile(
  peerId: string,
  rtpParameters: RtpParameters,
  port: number,
  rtcpPort: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(liveFolder)) {
      fs.mkdirSync(liveFolder, { recursive: true });
      console.log("✅ Created live folder for audio");
    }

    const sdpContent = generateAudioSdp(rtpParameters, port, rtcpPort);
    const sdpPath = getAudioSDPPath(peerId);

    fs.writeFile(sdpPath, sdpContent, (err) => {
      if (err) {
        console.error("❌ Error writing Audio SDP file:", err);
        reject(err);
      } else {
        console.log("✅ Audio SDP written:", sdpPath);
        console.log("📄 Audio SDP content:", sdpContent);
        resolve();
      }
    });
  });
}

export async function writeSdpFile(
  peerId: string,
  rtpParameters: RtpParameters,
  port: number,
  rtcpPort: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(liveFolder)) {
      fs.mkdirSync(liveFolder, { recursive: true });
      console.log("✅ Created live folder for video");
    }

    const sdpContent = generateSdp(rtpParameters, port, rtcpPort);
    const sdpPath = getSDPPath(peerId);

    fs.writeFile(sdpPath, sdpContent, (err) => {
      if (err) {
        console.error("❌ Error writing Video SDP file:", err);
        reject(err);
      } else {
        console.log("✅ Video SDP written:", sdpPath);
        console.log("📄 Video SDP content:", sdpContent);
        resolve();
      }
    });
  });
}

export function writeMasterPlaylist(peerId: string) {
  const content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="${getAudioPlaylistName(
    peerId
  )}"
#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.42e01e,mp4a.40.2",AUDIO="audio"
${getVideoPlaylistName(peerId)}
`;

  const masterPath = path.join(__dirname, "public", "live", `${peerId}.m3u8`);
  fs.writeFileSync(masterPath, content);
  console.log("✅ Master playlist written:", masterPath);
}
