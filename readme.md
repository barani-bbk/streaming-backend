# live Streaming using webrtc

A Node.js + mediasoup server that:

- Receives live WebRTC streams from peers
- Transcodes them into HLS (video & audio) using FFmpeg
- Generates master playlists for live playback
- Supports multiple peers, dynamic producers, and HLS live viewing

---

## Features

- Live WebRTC → HLS conversion per peer
- Master playlist combining audio & video
- Dynamic peer management
- Modular structure (services, handlers, utils, models)
- Built with mediasoup, FFmpeg, and TypeScript

---

## Project structure

```
public/live/              # Generated HLS playlists & segments
src/
├── config/               # Server & mediasoup configuration
│   ├── index.ts
│   ├── mediasoup.config.ts
│   └── server.config.ts
├── services/             # Core services
│   ├── HlsService.ts          # FFmpeg spawn & SDP management
│   ├── MediasoupService.ts   # Mediasoup worker, router setup
│   └── PeerManager.ts        # Manage connected peers
├── handlers/             # Socket & HTTP event handlers
│   ├── sseHandler.ts          # Server-Sent Events for updates
│   ├── socketHandler.ts      # Socket.io connection & messaging
│   └── webrtcHandlers.ts    # Transport/producer/consumer events
├── models/
│   └── Peer.ts            # Peer model: transports, producers, consumers
├── utils/
│   ├── Logger.ts         # Centralized logger
│   └── PortManager.ts    # Dynamic port allocation for PlainTransports
└── index.ts              # App entry point
```

---

## Requirements

- Node.js >= 18
- FFmpeg installed and in PATH
- Linux / macOS recommended (tested)
- Open UDP ports (e.g., 2000–2020) for mediasoup RTP

---

## Setup

```bash
git clone https://github.com/barani-bbk/streaming-backend.git
cd streaming-backend
npm install
```

---

## Running the server

```bash
npm run dev
```

- Starts Node server with mediasoup + FFmpeg.
- WebSocket server listens on: `http://localhost:4000`
- HLS output in: `public/live/`

---

## Usage

- Frontend uses WebRTC to send video & audio.
- Server:

  - Consumes media streams
  - Writes SDP files
  - Starts FFmpeg processes

- FFmpeg creates:

  - Audio `.m3u8` playlist + `.ts` segments
  - Video `.m3u8` playlist + `.ts` segments
  - Master playlist combining both

---

## Scripts

|         Command | Description                   |
| --------------: | ----------------------------- |
|   `npm run dev` | Start server in development   |
| `npm run build` | Build TypeScript → JavaScript |
|     `npm start` | Run built server              |

---

## HLS Output (per peer)

```
public/live/
  ├─ <peerId>-video.m3u8
  ├─ <peerId>-audio.m3u8
  ├─ <peerId>.m3u8              # Master playlist
  ├─ video_<peerId>_001.ts ...
  └─ audio_<peerId>_001.ts ...
```

---
