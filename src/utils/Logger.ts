const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

class Logger {
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private log(level: LogLevel, color: string, message: string, ...args: any[]) {
    console.log(
      `${color}[${this.getTimestamp()}] [${level}]${colors.reset} ${message}`,
      ...args
    );
  }

  public info(message: string, ...args: any[]) {
    this.log("INFO", colors.green, message, ...args);
  }

  public warn(message: string, ...args: any[]) {
    this.log("WARN", colors.yellow, message, ...args);
  }

  public error(message: string, ...args: any[]) {
    this.log("ERROR", colors.red, message, ...args);
  }

  public debug(message: string, ...args: any[]) {
    this.log("DEBUG", colors.cyan, message, ...args);
  }

  public ffmpeg(message: string, ...args: any[]) {
    this.log("DEBUG", colors.magenta, `[FFMPEG] ${message}`, ...args);
  }
}

export const logger = new Logger();
