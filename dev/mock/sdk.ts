/**
 * Stand-in for "azure-devops-extension-sdk" (swapped in by the dev build through an esbuild alias).
 * It plays the host: hands out context, services and a token, applies a theme,
 * and for dashboard pages calls the registered widget / configuration object the way a dashboard would.
 */
import { MOCK_BASE, MOCK_TOKEN } from "./api.ts";
import { mock } from "./state.ts";

export interface IExtensionInitOptions { loaded?: boolean; applyTheme?: boolean }

export async function init(options: IExtensionInitOptions = {}): Promise<void> {
  mock.initOptions = options;
  if (options.applyTheme) mock.setTheme(mock.theme);
}

export async function ready(): Promise<void> {}

export function getWebContext() {
  return {
    project: { id: mock.project.id, name: mock.project.name },
    team: mock.team ? { id: mock.team.id, name: mock.team.name } : (undefined as unknown as { id: string; name: string }),
  };
}

export function getContributionId(): string {
  return `TomaszZelezny.aging-wip.${mock.contributionId}`;
}

export async function getAccessToken(): Promise<string> {
  return MOCK_TOKEN;
}

export function register(instanceId: string, instance: unknown): void {
  mock.registered.set(instanceId, typeof instance === "function" ? (instance as () => unknown)() : instance);
}

export async function notifyLoadSucceeded(): Promise<void> {
  mock.loaded = true;
  // The host talks to the registered object after the extension reports it is loaded.
  setTimeout(() => void mock.driveHost(), 0);
}

export async function notifyLoadFailed(e: unknown): Promise<void> {
  mock.loadError = String(e);
}

export async function getService<T>(id: string): Promise<T> {
  switch (id) {
    case "ms.vss-features.location-service":
      return { getServiceLocation: async () => location.origin + MOCK_BASE } as T;
    case "ms.vss-work-web.work-item-form-navigation-service":
      return { openWorkItem: async (wid: number) => { mock.opened.push(wid); } } as T;
    default:
      throw new Error(`Mock SDK: unknown service ${id}`);
  }
}
