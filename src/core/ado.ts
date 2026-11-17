import * as SDK from "azure-devops-extension-sdk";

const API = "api-version=7.1";

interface ILocationService {
  getServiceLocation(serviceInstanceType?: string, hostType?: number): Promise<string>;
}

let baseUrl: Promise<string> | undefined;

/** Collection root URL, e.g. https://dev.azure.com/org/ (works on Azure DevOps Server too). */
export function collectionUrl(): Promise<string> {
  baseUrl ??= SDK.getService<ILocationService>("ms.vss-features.location-service")
    .then((loc) => loc.getServiceLocation())
    .then((u) => (u.endsWith("/") ? u : u + "/"));
  return baseUrl;
}

/** A request that has not answered by then is cancelled and tried again (Azure DevOps sometimes never answers one). */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Attempts per request: the first plus retries after a timeout, throttling (429) or a server error (5xx). */
const ATTEMPTS = 3;

export interface RequestOptions {
  /** Cancels the request, e.g. when a newer load supersedes this one. It then rejects with an AbortError. */
  signal?: AbortSignal;
}

class RetryableError extends Error {
  constructor(message: string, readonly retryAfterMs = 0) { super(message); }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const t = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(t); reject(signal!.reason); };
  signal?.addEventListener("abort", stop, { once: true });
});

async function attempt<T>(method: "GET" | "POST", path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const [root, token] = await Promise.all([collectionUrl(), SDK.getAccessToken()]);
  signal?.throwIfAborted();
  const url = root + path + (path.includes("?") ? "&" : "?") + API;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, REQUEST_TIMEOUT_MS);
  const cancel = () => ctrl.abort(signal!.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    // The timer covers reading the body too: a response can stall after its headers.
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { msg = (await res.json()).message ?? msg; } catch { /* keep status text */ }
      msg = `Azure DevOps API: ${msg}`;
      if (res.status === 429 || res.status >= 500) {
        const after = Number(res.headers.get("Retry-After"));
        throw new RetryableError(msg, Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 0);
      }
      throw new Error(msg);
    }
    return await (res.json() as Promise<T>);
  } catch (e) {
    if (signal?.aborted) throw signal.reason;
    if (timedOut) throw new RetryableError(`Azure DevOps API: no answer within ${REQUEST_TIMEOUT_MS / 1000} s (${path.split("?")[0]})`);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, { signal }: RequestOptions = {}): Promise<T> {
  // POSTs here are reads too (WIQL, workitemsbatch), so retrying them is safe.
  for (let n = 1; ; n++) {
    try {
      return await attempt<T>(method, path, body, signal);
    } catch (e) {
      if (!(e instanceof RetryableError)) throw e;
      if (n >= ATTEMPTS) throw new Error(e.message);
      await sleep(e.retryAfterMs || 1000 * n, signal);
    }
  }
}

export const get = <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts);
export const post = <T>(path: string, body: unknown, opts?: RequestOptions) => request<T>("POST", path, body, opts);

export const seg = encodeURIComponent;
