import path from "path";

export const serverConfig = {
  listenIp: "127.0.0.1",
  port: process.env.PORT || 4000,
  liveDirectory: path.join(__dirname, "..", "..", "public", "live"),
};
