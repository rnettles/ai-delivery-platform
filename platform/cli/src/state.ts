import * as fs from "fs";
import * as path from "path";

export interface ActiveState {
  channel_id: string;
  pipeline_id: string;
}

const STATE_FILE = path.join(__dirname, "..", "..", ".adp-cli.state.json");

export function loadState(): ActiveState {
  try {
    if (!fs.existsSync(STATE_FILE)) return { channel_id: "", pipeline_id: "" };
    const raw = fs.readFileSync(STATE_FILE, "utf8").trim();
    if (!raw) return { channel_id: "", pipeline_id: "" };
    const parsed = JSON.parse(raw) as Partial<ActiveState>;
    return {
      channel_id: parsed.channel_id ?? "",
      pipeline_id: parsed.pipeline_id ?? "",
    };
  } catch {
    return { channel_id: "", pipeline_id: "" };
  }
}

export function saveState(state: ActiveState): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function clearState(): void {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}
