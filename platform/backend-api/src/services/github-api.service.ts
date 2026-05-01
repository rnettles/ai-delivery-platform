import { config } from "../config";
import { GithubRequestMetadata } from "../domain/admin-ops.types";
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

export interface GithubPrPreflightResult {
  ok: boolean;
  blocked_reason?: "INVALID_REPO_URL" | "GITHUB_TOKEN_MISSING" | "REPO_NOT_FOUND" | "BASE_BRANCH_MISSING" | "HEAD_BRANCH_MISSING" | "API_UNREACHABLE";
  owner?: string;
  repo?: string;
  repo_reachable: boolean;
  base_branch_exists: boolean;
  head_branch_exists: boolean;
  request_metadata: GithubRequestMetadata[];
}

interface RepoRef {
  owner: string;
  repo: string;
}

export class GithubApiError extends Error {
  public readonly statusCode?: number;
  public readonly metadata: GithubRequestMetadata;
  public readonly responseBody?: string;

  constructor(message: string, opts: { statusCode?: number; metadata: GithubRequestMetadata; responseBody?: string }) {
    super(message);
    this.name = "GithubApiError";
    this.statusCode = opts.statusCode;
    this.metadata = opts.metadata;
    this.responseBody = opts.responseBody;
  }
}

function sanitizeBody(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const payload = body as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && value.length > 500) {
      next[key] = `${value.slice(0, 500)}...(truncated)`;
      continue;
    }
    next[key] = value;
  }

  return next;
}

export function parseRepoUrl(repoUrl: string): RepoRef {
  const normalized = repoUrl.replace(/\.git$/, "");

  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new GithubApiError(`Unsupported GitHub repo URL format: ${repoUrl}`, {
    metadata: {
      endpoint: "repo-url-parse",
      sanitized_body: { repoUrl },
    },
  });
}

class GithubApiService {
  getApiDiagnostics(): { base_url: string; token_configured: boolean } {
    return {
      base_url: config.githubApiBaseUrl,
      token_configured: Boolean(config.githubToken),
    };
  }

  private async request<T>(
    repoUrl: string,
    endpointPath: string,
    method: "GET" | "POST" | "PUT",
    body?: unknown,
    metadata?: Omit<GithubRequestMetadata, "endpoint" | "status_code" | "sanitized_body">
  ): Promise<T> {
    const token = config.githubToken;
    if (!token) {
      throw new GithubApiError("GitHub API token not configured. Set GITHUB_TOKEN (or GIT_PAT fallback).", {
        metadata: {
          endpoint: endpointPath,
          ...metadata,
          sanitized_body: sanitizeBody(body),
        },
      });
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
      throw new GithubApiError(
        `GitHub request failed: ${response.status} ${response.statusText}`,
        {
          statusCode: response.status,
          responseBody: errorText,
          metadata: {
            endpoint,
            owner,
            repo,
            ...metadata,
            status_code: response.status,
            sanitized_body: sanitizeBody(body),
          },
        }
      );
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

  async preflightPullRequest(opts: { repoUrl: string; base: string; head: string }): Promise<GithubPrPreflightResult> {
    const requestMetadata: GithubRequestMetadata[] = [];

    let owner = "";
    let repo = "";

    try {
      const parsed = parseRepoUrl(opts.repoUrl);
      owner = parsed.owner;
      repo = parsed.repo;
    } catch {
      return {
        ok: false,
        blocked_reason: "INVALID_REPO_URL",
        repo_reachable: false,
        base_branch_exists: false,
        head_branch_exists: false,
        request_metadata: requestMetadata,
      };
    }

    if (!config.githubToken) {
      return {
        ok: false,
        blocked_reason: "GITHUB_TOKEN_MISSING",
        owner,
        repo,
        repo_reachable: false,
        base_branch_exists: false,
        head_branch_exists: false,
        request_metadata: requestMetadata,
      };
    }

    try {
      await this.request<{ id: number }>(opts.repoUrl, "", "GET", undefined, {
        owner,
        repo,
      });
      requestMetadata.push({
        endpoint: `${config.githubApiBaseUrl}/repos/${owner}/${repo}`,
        owner,
        repo,
        status_code: 200,
      });
    } catch (error) {
      if (error instanceof GithubApiError) {
        requestMetadata.push(error.metadata);
        return {
          ok: false,
          blocked_reason: error.statusCode === 404 ? "REPO_NOT_FOUND" : "API_UNREACHABLE",
          owner,
          repo,
          repo_reachable: false,
          base_branch_exists: false,
          head_branch_exists: false,
          request_metadata: requestMetadata,
        };
      }
      throw error;
    }

    let baseBranchExists = false;
    let headBranchExists = false;

    try {
      await this.request(opts.repoUrl, `/branches/${encodeURIComponent(opts.base)}`, "GET", undefined, {
        owner,
        repo,
        base: opts.base,
      });
      baseBranchExists = true;
      requestMetadata.push({
        endpoint: `${config.githubApiBaseUrl}/repos/${owner}/${repo}/branches/${encodeURIComponent(opts.base)}`,
        owner,
        repo,
        base: opts.base,
        status_code: 200,
      });
    } catch (error) {
      if (error instanceof GithubApiError) {
        requestMetadata.push(error.metadata);
        return {
          ok: false,
          blocked_reason: error.statusCode === 404 ? "BASE_BRANCH_MISSING" : "API_UNREACHABLE",
          owner,
          repo,
          repo_reachable: true,
          base_branch_exists: false,
          head_branch_exists: false,
          request_metadata: requestMetadata,
        };
      }
      throw error;
    }

    try {
      await this.request(opts.repoUrl, `/branches/${encodeURIComponent(opts.head)}`, "GET", undefined, {
        owner,
        repo,
        head: opts.head,
      });
      headBranchExists = true;
      requestMetadata.push({
        endpoint: `${config.githubApiBaseUrl}/repos/${owner}/${repo}/branches/${encodeURIComponent(opts.head)}`,
        owner,
        repo,
        head: opts.head,
        status_code: 200,
      });
    } catch (error) {
      if (error instanceof GithubApiError) {
        requestMetadata.push(error.metadata);
        return {
          ok: false,
          blocked_reason: error.statusCode === 404 ? "HEAD_BRANCH_MISSING" : "API_UNREACHABLE",
          owner,
          repo,
          repo_reachable: true,
          base_branch_exists: baseBranchExists,
          head_branch_exists: false,
          request_metadata: requestMetadata,
        };
      }
      throw error;
    }

    return {
      ok: true,
      owner,
      repo,
      repo_reachable: true,
      base_branch_exists: baseBranchExists,
      head_branch_exists: headBranchExists,
      request_metadata: requestMetadata,
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
    }, {
      base: opts.base,
      head: opts.head,
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
      "GET",
      undefined,
      { base: opts.base, head: opts.head }
    );

    return payload.length > 0 ? this.mapPullRequest(payload[0]) : null;
  }

  async findMergedPullRequestByHead(opts: Omit<GithubPullRequestLookupOptions, "title">): Promise<GithubPullRequest | null> {
    const { owner } = parseRepoUrl(opts.repoUrl);
    if (!opts.head) {
      return null;
    }

    const params = new URLSearchParams({
      state: "closed",
      head: `${owner}:${opts.head}`,
      ...(opts.base ? { base: opts.base } : {}),
      per_page: "20",
    });

    // The list endpoint returns `merged_at` (timestamp or null) not `merged` (boolean).
    // A PR with a non-null merged_at was merged; one with null was closed/rejected.
    const payload = await this.request<Array<{ number: number; url: string; html_url: string; state: string; merged_at?: string | null }>>(
      opts.repoUrl,
      `/pulls?${params.toString()}`,
      "GET",
      undefined,
      { base: opts.base, head: opts.head }
    );

    const merged = payload.find((pr) => pr.merged_at != null);
    return merged ? this.mapPullRequest({ ...merged, merged: true }) : null;
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
      "GET",
      undefined,
      { base: opts.base }
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
      throw new GithubApiError("GitHub API token not configured. Set GITHUB_TOKEN (or GIT_PAT fallback).", {
        metadata: {
          endpoint: "listPullRequestReviews",
        },
      });
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
      throw new GithubApiError(`GitHub listPullRequestReviews failed: ${response.status} ${response.statusText}`, {
        statusCode: response.status,
        responseBody: errorText,
        metadata: {
          endpoint,
          owner,
          repo,
          status_code: response.status,
        },
      });
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
      throw new GithubApiError("GitHub API token not configured. Set GITHUB_TOKEN (or GIT_PAT fallback).", {
        metadata: {
          endpoint: "mergePullRequest",
        },
      });
    }

    const { owner, repo } = parseRepoUrl(opts.repoUrl);
    const endpoint = `${config.githubApiBaseUrl}/repos/${owner}/${repo}/pulls/${opts.number}/merge`;

    const body = {
      ...(opts.commitTitle ? { commit_title: opts.commitTitle } : {}),
    };

    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new GithubApiError(`GitHub mergePullRequest failed: ${response.status} ${response.statusText}`, {
        statusCode: response.status,
        responseBody: errorText,
        metadata: {
          endpoint,
          owner,
          repo,
          status_code: response.status,
          sanitized_body: sanitizeBody(body),
        },
      });
    }

    logger.info("GitHub PR merged", {
      owner,
      repo,
      pr_number: opts.number,
    });
  }
}

export const githubApiService = new GithubApiService();
