export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface ClientConfig {
  baseUrl: string;
  apiKey?: string;
}

let _config: ClientConfig = {
  baseUrl: process.env.ADP_API_BASE_URL ?? "http://localhost:3000",
  apiKey: process.env.ADP_API_KEY ?? "",
};

export function configureClient(config: Partial<ClientConfig>): void {
  _config = { ..._config, ...config };
}

export function getClientConfig(): ClientConfig {
  return _config;
}

function buildUrl(relativePath: string, query?: RequestOptions["query"]): string {
  const base = _config.baseUrl.replace(/\/$/, "");
  const p = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  const url = `${base}${p}`;

  if (!query) return url;

  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

  return params ? `${url}?${params}` : url;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (_config.apiKey) {
    headers["x-api-key"] = _config.apiKey;
  }
  return headers;
}

export async function request<T = unknown>(opts: RequestOptions): Promise<T> {
  const method = opts.method ?? "GET";
  const url = buildUrl(opts.path, opts.query);
  const headers = buildHeaders();

  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }

  const res = await fetch(url, init);

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.text();
      detail = errBody;
    } catch {
      // ignore
    }
    const err = new Error(
      `HTTP ${res.status} ${res.statusText} — ${method} ${url}${detail ? `\n${detail}` : ""}`
    );
    (err as NodeJS.ErrnoException).code = String(res.status);
    throw err;
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }

  const text = await res.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
