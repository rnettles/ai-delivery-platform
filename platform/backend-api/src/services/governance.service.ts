import fs from "fs/promises";
import path from "path";
import { config } from "../config";
import { logger } from "./logger.service";

interface GovernanceManifest {
  version: string;
  roles: Record<string, { prompt: string }>;
  rules: Record<string, string>;
  schemas: Record<string, string>;
}

/**
 * Loads governance content (prompts, rules, schemas) from the platform governance directory.
 * In production the governance directory is bundled into the Docker image at /app/governance/.
 * Override the path via GOVERNANCE_PATH env var (required for local development).
 * See ADR-025 for the two-tier governance composition model.
 */
class GovernanceService {
  private manifest: GovernanceManifest | null = null;
  private resolvedBasePath: string | null = null;

  private async getBasePath(): Promise<string> {
    if (this.resolvedBasePath) {
      return this.resolvedBasePath;
    }

    const configured = path.resolve(process.cwd(), config.governancePath);
    const candidates = [
      configured,
      path.resolve(process.cwd(), "../governance"),
      path.resolve(__dirname, "../../governance"),
      path.resolve(__dirname, "../../../governance"),
    ];

    for (const candidate of candidates) {
      const manifestPath = path.join(candidate, "manifest.json");
      try {
        await fs.access(manifestPath);
        this.resolvedBasePath = candidate;
        if (candidate !== configured) {
          logger.info("Governance path fallback applied", {
            configured_path: configured,
            resolved_path: candidate,
          });
        }
        return candidate;
      } catch {
        // Try next candidate path.
      }
    }

    throw new Error(
      `Governance manifest not found. Checked: ${candidates
        .map((p) => path.join(p, "manifest.json"))
        .join(", ")}`
    );
  }

  private async loadManifest(): Promise<GovernanceManifest> {
    if (this.manifest) return this.manifest;
    const basePath = await this.getBasePath();
    const manifestPath = path.join(basePath, "manifest.json");
    const raw = await fs.readFile(manifestPath, "utf-8");
    this.manifest = JSON.parse(raw) as GovernanceManifest;
    logger.info("Governance manifest loaded", { version: this.manifest.version, path: manifestPath });
    return this.manifest;
  }

  async getPrompt(role: string): Promise<string> {
    const manifest = await this.loadManifest();
    const entry = manifest.roles[role];
    if (!entry) throw new Error(`Governance: no prompt registered for role '${role}'`);
    const promptPath = path.join(await this.getBasePath(), entry.prompt);
    return fs.readFile(promptPath, "utf-8");
  }

  async getRule(key: string): Promise<string> {
    const manifest = await this.loadManifest();
    const entry = manifest.rules[key];
    if (!entry) throw new Error(`Governance: no rule registered for key '${key}'`);
    const rulePath = path.join(await this.getBasePath(), entry);
    return fs.readFile(rulePath, "utf-8");
  }

  async getSchema(key: string): Promise<unknown> {
    const manifest = await this.loadManifest();
    const entry = manifest.schemas[key];
    if (!entry) throw new Error(`Governance: no schema registered for key '${key}'`);
    const schemaPath = path.join(await this.getBasePath(), entry);
    const raw = await fs.readFile(schemaPath, "utf-8");
    return JSON.parse(raw) as unknown;
  }

  async getVersion(): Promise<string> {
    const manifest = await this.loadManifest();
    return manifest.version;
  }

  /**
   * Returns the raw parsed manifest object.
   * Used by the LLM factory to read llm_roles configuration.
   */
  async getManifest(): Promise<GovernanceManifest & Record<string, unknown>> {
    return this.loadManifest() as Promise<GovernanceManifest & Record<string, unknown>>;
  }
}

export const governanceService = new GovernanceService();
