import * as fs from "fs";
import * as path from "path";

export function loadEnvFile(filePath: string): string[] {
  const candidates: string[] = [];

  if (path.isAbsolute(filePath)) {
    candidates.push(filePath);
  } else {
    candidates.push(path.join(process.cwd(), filePath));
    // Fallback to the standard backend-api .env.local relative to the cli package
    const cliRoot = path.join(__dirname, "..", "..", "..");
    candidates.push(path.join(cliRoot, "backend-api", filePath));
    candidates.push(path.join(cliRoot, "backend-api", ".env.local"));
  }

  const resolved = candidates.find((c) => fs.existsSync(c));
  if (!resolved) {
    throw new Error(
      `Env file not found: ${filePath}. Tried:\n  ${candidates.join("\n  ")}`
    );
  }

  const loaded: string[] = [];
  const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);

  for (let raw of lines) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
    loaded.push(key);
  }

  console.log(`Loaded ${loaded.length} variable(s) from ${resolved}`);
  if (loaded.length > 0) {
    console.log(`Keys: ${loaded.sort().join(", ")}`);
  }

  return loaded;
}
