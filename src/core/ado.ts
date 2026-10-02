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

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const [root, token] = await Promise.all([collectionUrl(), SDK.getAccessToken()]);
  const url = root + path + (path.includes("?") ? "&" : "?") + API;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).message ?? msg; } catch { /* keep status text */ }
    throw new Error(`Azure DevOps API: ${msg}`);
  }
  return res.json() as Promise<T>;
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body: unknown) => request<T>("POST", path, body);

export const seg = encodeURIComponent;
