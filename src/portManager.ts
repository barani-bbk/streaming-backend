import net from "net";

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
        const available = await this.isPortAvailable(port);
        if (available) {
          this.usedPorts.add(port);
          console.log(
            `✅ Allocated port ${port}. Used ports:`,
            Array.from(this.usedPorts)
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
    this.usedPorts.delete(port);
    console.log(
      `🔄 Released port ${port}. Used ports:`,
      Array.from(this.usedPorts)
    );
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", (err: any) => {
        resolve(false);
      });

      server.once("listening", () => {
        server.close(() => {
          resolve(true);
        });
      });

      const timeout = setTimeout(() => {
        server.close();
        resolve(false);
      }, 1000);

      server.listen(port, "127.0.0.1", () => {
        clearTimeout(timeout);
      });
    });
  }

  getUsedPorts(): number[] {
    return Array.from(this.usedPorts);
  }
}

const portManager = new PortManager(6000, 7000);

export { portManager };
