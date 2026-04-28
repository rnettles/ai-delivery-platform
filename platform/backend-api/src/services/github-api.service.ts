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

export interface GithubPullRequestLookupOptions {
  repoUrl: string;
  base?: string;
  head?: string;
  title?: string;
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
  private async request<T>(repoUrl: string, endpointPath: string, method: "GET" | "POST" | "PUT", body?: unknown): Promise<T> {
    const token = config.githubToken;
    if (!token) {
      throw new Error("GitHub API token not configured. Set GITHUB_TOKEN (or GIT_PAT fallback).");
    }

    const { owner, repo } = parseRepoUrl(repoUrl);
    const endpoint = `${config.githubApiBaseUrl}/repos/${owner}/${repo}${endpointPath}`;

    const response = await fetch(endpoint, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub request failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as T;
  }

  private mapPullRequest(payload: {
    number: number;
    url: string;
    html_url: string;
    state: string;
    merged?: boolean;
  }): GithubPullRequest {
    return {
      number: payload.number,
      url: payload.url,
      html_url: payload.html_url,
      state: payload.state,
      merged: payload.merged ?? false,
    };
  }

  async createPullRequest(opts: {
    repoUrl: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<GithubPullRequest> {
    const payload = await this.request<{
      number: number;
      url: string;
      html_url: string;
      state: string;
      merged?: boolean;
    }>(opts.repoUrl, "/pulls", "POST", {
        title: opts.title,
        body: opts.body,
        head: opts.head,
        base: opts.base,
    });

    const { owner, repo } = parseRepoUrl(opts.repoUrl);

    logger.info("GitHub PR created", {
      owner,
      repo,
      pr_number: payload.number,
      pr_url: payload.html_url,
    });

    return this.mapPullRequest(payload);
  }

  async findOpenPullRequestByHead(opts: Omit<GithubPullRequestLookupOptions, "title">): Promise<GithubPullRequest | null> {
    const { owner } = parseRepoUrl(opts.repoUrl);
    if (!opts.head) {
      return null;
    }

    const params = new URLSearchParams({
      state: "open",
      head: `${owner}:${opts.head}`,
      ...(opts.base ? { base: opts.base } : {}),
      per_page: "20",
    });

    const payload = await this.request<Array<{ number: number; url: string; html_url: string; state: string; merged?: boolean }>>(
      opts.repoUrl,
      `/pulls?${params.toString()}`,
      "GET"
    );

    return payload.length > 0 ? this.mapPullRequest(payload[0]) : null;
  }

  async findOpenPullRequestByTitle(opts: Omit<GithubPullRequestLookupOptions, "head">): Promise<GithubPullRequest | null> {
    if (!opts.title) {
      return null;
    }

    const params = new URLSearchParams({
      state: "open",
      ...(opts.base ? { base: opts.base } : {}),
      per_page: "50",
    });

    const payload = await this.request<Array<{ number: number; url: string; html_url: string; state: string; merged?: boolean; title?: string }>>(
      opts.repoUrl,
      `/pulls?${params.toString()}`,
      "GET"
    );

    const match = payload.find((pr) => (pr.title ?? "") === opts.title);
    return match ? this.mapPullRequest(match) : null;
  }

  async getPullRequest(opts: { repoUrl: string; number: number }): Promise<GithubPullRequest> {
    const payload = await this.request<{
      number: number;
      url: string;
      html_url: string;
      state: string;
      merged?: boolean;
    }>(opts.repoUrl, `/pulls/${opts.number}`, "GET");

    return this.mapPullRequest(payload);
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
