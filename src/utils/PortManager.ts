import net from "net";
import { logger } from "./Logger";

class PortManager {
  private usedPorts = new Set<number>();
  private minPort: number;
  private maxPort: number;

  constructor(minPort: number = 6000, maxPort: number = 7000) {
    this.minPort = minPort;
    this.maxPort = maxPort;
  }

  async getAvailablePort(): Promise<number> {
    for (let port = this.minPort; port <= this.maxPort; port++) {
      if (!this.usedPorts.has(port)) {
        const isAvailable = await this.isPortAvailable(port);
        if (isAvailable) {
          this.usedPorts.add(port);
          logger.debug(
            `Allocated port ${port}. Used ports: [${Array.from(
              this.usedPorts
            ).join(", ")}]`
          );
          return port;
        }
      }
    }
    throw new Error(
      `No available ports in range ${this.minPort}-${this.maxPort}`
    );
  }

  releasePort(port: number): void {
    if (this.usedPorts.has(port)) {
      this.usedPorts.delete(port);
      logger.debug(
        `Released port ${port}. Used ports: [${Array.from(this.usedPorts).join(
          ", "
        )}]`
      );
    }
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", () => {
        resolve(false);
      });

      server.once("listening", () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port, "127.0.0.1");
    });
  }

  public getUsedPorts(): number[] {
    return Array.from(this.usedPorts);
  }
}

export const portManager = new PortManager();
