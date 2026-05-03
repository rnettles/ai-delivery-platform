const PRETTY = process.env.LOG_FORMAT === "pretty";

// ─── In-memory ring buffer ────────────────────────────────────────────────────
const LOG_BUFFER_SIZE = 500;

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  context: Record<string, unknown>;
}

const logBuffer: LogEntry[] = [];

function pushToBuffer(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
}

/** Returns a snapshot of recent log entries, newest last. */
export function getLogs(limit = 200): LogEntry[] {
  return logBuffer.slice(-limit);
}

const ANSI = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
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

// Keys that carry the most diagnostic value — rendered inline with brighter contrast.
// Everything else is secondary and wraps to a continuation line.
const PRIMARY_KEYS = new Set([
  "pipeline_id", "role", "status", "current_step", "project",
  "caller", "sprint_branch", "pr_number", "changed",
]);

function fmtValue(v: unknown): string {
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

function formatPretty(level: string, message: string, context?: Record<string, unknown>): string {
  const ts = new Date().toISOString().substring(11, 19); // HH:mm:ss
  const style = LEVEL_STYLE[level] ?? { color: ANSI.white, label: level.toUpperCase().padEnd(5) };
  const prefix = `${ANSI.gray}[${ts}]${ANSI.reset} ${style.color}${ANSI.bold}${style.label}${ANSI.reset}`;
  // indent for continuation lines: "[HH:mm:ss] LEVEL  " = 10 + 2 + 5 + 2 = 19 chars
  const indent = " ".repeat(19);

  if (!context || Object.keys(context).length === 0) {
    return `${prefix}  ${message}`;
  }

  const primary: [string, unknown][] = [];
  const secondary: [string, unknown][] = [];
  for (const [k, v] of Object.entries(context)) {
    (PRIMARY_KEYS.has(k) ? primary : secondary).push([k, v]);
  }

  const primaryStr = primary.length > 0
    ? "  " + primary.map(([k, v]) =>
        `${ANSI.white}${k}${ANSI.gray}=${ANSI.reset}${fmtValue(v)}`
      ).join(`  `)
    : "";

  const secondaryStr = secondary.length > 0
    ? "\n" + indent + ANSI.gray + secondary.map(([k, v]) =>
        `${k}=${fmtValue(v)}`
      ).join("  ") + ANSI.reset
    : "";

  return `${prefix}  ${message}${primaryStr}${secondaryStr}`;
}

export class LoggerService {
  info(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = { timestamp: new Date().toISOString(), level: "info", message, context: context ?? {} };
    pushToBuffer(entry);
    if (PRETTY) {
      process.stdout.write(formatPretty("info", message, context) + "\n");
    } else {
      console.log(JSON.stringify({ level: "info", message, ...context, timestamp: entry.timestamp }));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = { timestamp: new Date().toISOString(), level: "warn", message, context: context ?? {} };
    pushToBuffer(entry);
    if (PRETTY) {
      process.stderr.write(formatPretty("warn", message, context) + "\n");
    } else {
      console.warn(JSON.stringify({ level: "warn", message, ...context, timestamp: entry.timestamp }));
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = { timestamp: new Date().toISOString(), level: "error", message, context: context ?? {} };
    pushToBuffer(entry);
    if (PRETTY) {
      process.stderr.write(formatPretty("error", message, context) + "\n");
    } else {
      console.error(JSON.stringify({ level: "error", message, ...context, timestamp: entry.timestamp }));
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = { timestamp: new Date().toISOString(), level: "debug", message, context: context ?? {} };
    pushToBuffer(entry);
    if (PRETTY) {
      process.stdout.write(formatPretty("debug", message, context) + "\n");
    } else {
      console.log(JSON.stringify({ level: "debug", message, ...context, timestamp: entry.timestamp }));
    }
  }
}

export const logger = new LoggerService();
