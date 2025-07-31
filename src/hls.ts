import { spawn } from "child_process";
import fs from "fs";
import { RtpParameters } from "mediasoup/node/lib/rtpParametersTypes";
import path from "path";

const liveFolder = path.join(__dirname, "public", "live");

function getSDPPath(peerId: string) {
  return path.join(liveFolder, `video.sdp`);
}

function getAudioSDPPath(peerId: string) {
  return path.join(liveFolder, `audio.sdp`);
}

export function startFfmpegForHls(peerId: string) {
  const outputPath = path.join(liveFolder, `video.m3u8`);
  const sdpPath = getSDPPath(peerId);

  // Check if SDP file exists
  if (!fs.existsSync(sdpPath)) {
    console.error("❌ Video SDP file not found:", sdpPath);
    return null;
  }

  const args = [
    "-protocol_whitelist",
    "file,udp,rtp",
    "-f",
    "sdp",
    "-i",
    sdpPath,

    // Video codec settings
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-g",
    "30", // Keyframe interval
    "-sc_threshold",
    "0", // Disable scene change detection

    // HLS options
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "5",
    "-hls_flags",
    "delete_segments",
    "-hls_segment_filename",
    path.join(liveFolder, `video_%03d.ts`),
    outputPath,
  ];

  console.log("🎥 Starting FFmpeg for video:", peerId);
  const ffmpeg = spawn("ffmpeg", args, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  // Log output for debugging
  ffmpeg.stdout.on("data", (data) => {
    console.log(`FFmpeg Video stdout: ${data}`);
  });

  ffmpeg.stderr.on("data", (data) => {
    console.log(`FFmpeg Video stderr: ${data}`);
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
  const outputPath = path.join(liveFolder, `audio.m3u8`);
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
    path.join(liveFolder, `audio_%03d.ts`),
    outputPath,
  ];

  console.log("🎵 Starting FFmpeg for audio:", peerId);
  const ffmpeg = spawn("ffmpeg", args, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
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

export function generateSdp(rtpParameters: RtpParameters) {
  const codec = rtpParameters.codecs[0];
  const payloadType = codec.payloadType;
  const codecName = codec.mimeType.split("/")[1];
  const clockRate = codec.clockRate;

  const sdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Mediasoup RTP Video
c=IN IP4 127.0.0.1
t=0 0
m=video 5004 RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${codecName}/${clockRate}
a=recvonly`;

  return sdp;
}

export function generateAudioSdp(rtpParameters: RtpParameters) {
  const codec = rtpParameters.codecs[0];
  const payloadType = codec.payloadType;
  const codecName = codec.mimeType.split("/")[1];
  const clockRate = codec.clockRate;

  // Handle channel info for audio
  const channels = codec.channels || 2;

  const audioSdp = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Mediasoup RTP Audio
c=IN IP4 127.0.0.1
t=0 0
m=audio 5006 RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${codecName}/${clockRate}/${channels}
a=recvonly`;

  return audioSdp;
}

export async function writeAudioSdpFile(
  peerId: string,
  rtpParameters: any
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(liveFolder)) {
      fs.mkdirSync(liveFolder, { recursive: true });
      console.log("✅ Created live folder for audio");
    }

    const sdpContent = generateAudioSdp(rtpParameters);
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
  rtpParameters: any
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(liveFolder)) {
      fs.mkdirSync(liveFolder, { recursive: true });
      console.log("✅ Created live folder for video");
    }

    const sdpContent = generateSdp(rtpParameters);
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
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.42e01e,mp4a.40.2",AUDIO="audio"
video.m3u8
`;

  const masterPath = path.join(__dirname, "public", "live", `master.m3u8`);
  fs.writeFileSync(masterPath, content);
  console.log("✅ Master playlist written:", masterPath);
}
