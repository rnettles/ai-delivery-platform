import { request } from "./client";

export interface NotificationPayload {
  status: "INFO" | "ERROR";
  command: string;
  message: string;
  channel_id?: string;
  metadata: {
    method: string;
    path: string;
    cli_source: string;
  };
}

/**
 * Builds a rich notification message from the typed formatter summary line.
 * The formatter already extracted the meaningful fields, so this is just packaging.
 */
export function buildNotificationMessage(opts: {
  status: "INFO" | "ERROR";
  command: string;
  method: string;
  path: string;
  /** Output from the per-command formatter — carries full field fidelity */
  formatterSummary?: string;
  /** Error detail for ERROR status */
  errorDetail?: string;
}): string {
  const verb = opts.status === "ERROR" ? "failed" : "succeeded";
  const header = `CLI '${opts.command}' ${verb} — ${opts.method} ${opts.path}`;

  const detail = opts.status === "ERROR" ? opts.errorDetail : opts.formatterSummary;
  if (!detail?.trim()) return header;

  // Truncate to avoid Slack block kit limits
  const flat = detail.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const truncated = flat.length > 280 ? flat.slice(0, 279) + "…" : flat;
  return `${header}\n${truncated}`;
}

/**
 * Sends a fire-and-forget notification to /pipeline/cli-notify.
 * Never throws — a failed notification must not fail the CLI command.
 */
export async function sendNotification(opts: {
  status: "INFO" | "ERROR";
  command: string;
  method: string;
  path: string;
  formatterSummary?: string;
  errorDetail?: string;
  channelId?: string;
  forceCliChannel?: boolean;
}): Promise<void> {
  // Prevent recursion on the notification endpoint itself
  if (opts.command === "request" && opts.path.includes("/pipeline/cli-notify")) {
    return;
  }

  const message = buildNotificationMessage(opts);
  if (!message) return;

  const payload: NotificationPayload = {
    status: opts.status,
    command: opts.command,
    message,
    metadata: {
      method: opts.method,
      path: opts.path,
      cli_source: "adp-cli (ts)",
    },
  };

  // Only attach channel_id when explicitly provided — let the backend fall back
  // to its CLI_NOTIFICATION_CHANNEL env var otherwise. The active-state channel_id
  // is for pipeline targeting, not CLI notification routing.
  if (!opts.forceCliChannel && opts.channelId) {
    payload.channel_id = opts.channelId;
  }

  try {
    await request({ method: "POST", path: "/pipeline/cli-notify", body: payload });
  } catch {
    // Non-blocking by design
  }
}
