export class LoggerService {
  info(message: string, context?: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: "info", message, ...context, timestamp: new Date().toISOString() }));
  }

  error(message: string, context?: Record<string, unknown>): void {
    console.error(JSON.stringify({ level: "error", message, ...context, timestamp: new Date().toISOString() }));
  }
}

export const logger = new LoggerService();
