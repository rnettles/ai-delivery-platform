import { config } from "../config";
import { logger } from "./logger.service";

export interface GithubPullRequest {
  number: number;
  url: string;
  html_url: string;
  state: string;
  merged: boolean;
}

export interface GithubPullRequestReview {
  state: string;
  user_login: string;
}

interface RepoRef {
  owner: string;
  repo: string;
}

function parseRepoUrl(repoUrl: string): RepoRef {
  // Supports both HTTPS and SSH URLs:
  // - https://github.com/owner/repo.git
  // - git@github.com:owner/repo.git
  const normalized = repoUrl.replace(/\.git$/, "");

  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new Error(`Unsupported GitHub repo URL format: ${repoUrl}`);
}

class GithubApiService {
  async createPullRequest(opts: {
    repoUrl: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<GithubPullRequest> {
    const token = config.githubToken;
    if (!token) {
      throw new Error("GitHub API token not configured. Set GITHUB_TOKEN (or GIT_PAT fallback).");
    }

    const { owner, repo } = parseRepoUrl(opts.repoUrl);
    const endpoint = `${config.githubApiBaseUrl}/repos/${owner}/${repo}/pulls`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        head: opts.head,
        base: opts.base,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub createPullRequest failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    const payload = (await response.json()) as {
      number: number;
      url: string;
      html_url: string;
      state: string;
      merged?: boolean;
    };

    logger.info("GitHub PR created", {
      owner,
      repo,
      pr_number: payload.number,
      pr_url: payload.html_url,
    });

    return {
      number: payload.number,
      url: payload.url,
      html_url: payload.html_url,
      state: payload.state,
      merged: payload.merged ?? false,
    };
  }

  async getPullRequest(opts: { repoUrl: string; number: number }): Promise<GithubPullRequest> {
    const token = config.githubToken;
    if (!token) {
      throw new Error("GitHub API token not configured. Set GITHUB_TOKEN (or GIT_PAT fallback).");
    }

    const { owner, repo } = parseRepoUrl(opts.repoUrl);
    const endpoint = `${config.githubApiBaseUrl}/repos/${owner}/${repo}/pulls/${opts.number}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub getPullRequest failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    const payload = (await response.json()) as {
      number: number;
      url: string;
      html_url: string;
      state: string;
      merged?: boolean;
    };

    return {
      number: payload.number,
      url: payload.url,
      html_url: payload.html_url,
      state: payload.state,
      merged: payload.merged ?? false,
    };
  }

  async listPullRequestReviews(opts: { repoUrl: string; number: number }): Promise<GithubPullRequestReview[]> {
    const token = config.githubToken;
    if (!token) {
      throw new Error("GitHub API token not configured. Set GITHUB_TOKEN (or GIT_PAT fallback).");
    }

    const { owner, repo } = parseRepoUrl(opts.repoUrl);
    const endpoint = `${config.githubApiBaseUrl}/repos/${owner}/${repo}/pulls/${opts.number}/reviews`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub listPullRequestReviews failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    const payload = (await response.json()) as Array<{ state?: string; user?: { login?: string } }>;
    return payload.map((review) => ({
      state: review.state ?? "",
      user_login: review.user?.login ?? "unknown",
    }));
  }

  async mergePullRequest(opts: { repoUrl: string; number: number; commitTitle?: string }): Promise<void> {
    const token = config.githubToken;
    if (!token) {
      throw new Error("GitHub API token not configured. Set GITHUB_TOKEN (or GIT_PAT fallback).");
    }

    const { owner, repo } = parseRepoUrl(opts.repoUrl);
    const endpoint = `${config.githubApiBaseUrl}/repos/${owner}/${repo}/pulls/${opts.number}/merge`;

    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(opts.commitTitle ? { commit_title: opts.commitTitle } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub mergePullRequest failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    logger.info("GitHub PR merged", {
      owner,
      repo,
      pr_number: opts.number,
    });
  }
}

export const githubApiService = new GithubApiService();
