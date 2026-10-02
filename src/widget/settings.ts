import { DEFAULT_SETTINGS, type AgingSettings } from "../core/types.ts";

/** Subset of the dashboard widget contracts (azure-devops-extension-api/Dashboard) that we use. */
export interface WidgetSettings {
  name: string;
  size: { columnSpan: number; rowSpan: number };
  customSettings: { data: string };
}

export interface WidgetStatus { state?: string; statusType?: number }

export interface ConfigurationContext {
  notify<T>(event: string, args: { data: T }): Promise<unknown>;
}

export const WidgetStatusType = { Success: 0, Failure: 1, Unconfigured: 2 } as const;
export const CONFIGURATION_CHANGE = "ms.vss-dashboards-web.configurationChange";

/** Unset team means "the dashboard's team", as opposed to "" (whole project). */
export type StoredSettings = Omit<AgingSettings, "teamId"> & { teamId?: string };

export function parseSettings(ws: WidgetSettings): StoredSettings {
  try {
    const raw = ws.customSettings?.data;
    if (raw) return { ...DEFAULT_SETTINGS, teamId: undefined, ...JSON.parse(raw) };
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_SETTINGS, teamId: undefined };
}
