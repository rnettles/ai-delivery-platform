import { execFileSync } from "child_process";
import { resolve } from "path";
import { GitSyncContext } from "../domain/execution.types";

export class GitSyncService {
  constructor(private readonly repoPath: string = process.env.GIT_REPO_PATH || resolve(process.cwd(), "..", "..")) {}

  getContext(): GitSyncContext {
    try {
      const headCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: this.repoPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();

      return {
        repo_path: this.repoPath,
        head_commit: headCommit,
        is_repo_accessible: true
      };
    } catch {
      return {
        repo_path: this.repoPath,
        is_repo_accessible: false
      };
    }
  }
}

export const gitSyncService = new GitSyncService();
