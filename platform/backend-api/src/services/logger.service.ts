const PRETTY = process.env.LOG_FORMAT === "pretty";

const ANSI = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  gray:   "\x1b[90m",
  cyan:   "\x1b[36m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  white:  "\x1b[37m",
};

const LEVEL_STYLE: Record<string, { color: string; label: string }> = {
  info:  { color: ANSI.cyan,   label: "INFO " },
  warn:  { color: ANSI.yellow, label: "WARN " },
  error: { color: ANSI.red,    label: "ERROR" },
  debug: { color: ANSI.gray,   label: "DEBUG" },
};

function formatPretty(level: string, message: string, context?: Record<string, unknown>): string {
  const ts = new Date().toISOString().substring(11, 19); // HH:mm:ss
  const style = LEVEL_STYLE[level] ?? { color: ANSI.white, label: level.toUpperCase().padEnd(5) };
  const ctx = context && Object.keys(context).length > 0
    ? "  " + ANSI.gray + Object.entries(context).map(([k, v]) =>
        `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`
      ).join("  ") + ANSI.reset
    : "";
  return `${ANSI.gray}[${ts}]${ANSI.reset} ${style.color}${ANSI.bold}${style.label}${ANSI.reset}  ${message}${ctx}`;
}

export class LoggerService {
  info(message: string, context?: Record<string, unknown>): void {
    if (PRETTY) {
      process.stdout.write(formatPretty("info", message, context) + "\n");
    } else {
      console.log(JSON.stringify({ level: "info", message, ...context, timestamp: new Date().toISOString() }));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (PRETTY) {
      process.stderr.write(formatPretty("warn", message, context) + "\n");
    } else {
      console.warn(JSON.stringify({ level: "warn", message, ...context, timestamp: new Date().toISOString() }));
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (PRETTY) {
      process.stderr.write(formatPretty("error", message, context) + "\n");
    } else {
      console.error(JSON.stringify({ level: "error", message, ...context, timestamp: new Date().toISOString() }));
    }
  }
}

export const logger = new LoggerService();
