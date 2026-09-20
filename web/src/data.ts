/** Load the published data bundle. See `ff_watchlist.export` for the writer. */

import type { ProjectionRow, ScheduledGame } from "./core.ts";
import type { Directory } from "./lineup.ts";

interface ManifestBase {
  schema: number;
  generated_at: string;
  season: number;
  /** Sleeper's season type: "pre", "regular", "post" or "off". */
  phase: string;
  demo: boolean;
}

export interface WeekManifest extends ManifestBase {
  week: number;
  projections: { source: string | null; attribution: string | null; fetched_at: string | null };
  media: { headshots: boolean; logos: boolean };
  files: { players: string; schedule: string; projections: string };
}

/** Published outside the regular season: there is no week to rank. */
export interface OffSeasonManifest extends ManifestBase {
  week: null;
}

export type Manifest = WeekManifest | OffSeasonManifest;

export interface Bundle {
  manifest: WeekManifest;
  directory: Directory;
  schedule: ScheduledGame[];
  projections: ProjectionRow[];
}

const SUPPORTED_SCHEMA = 1;

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function fetchManifest(base: string): Promise<Manifest> {
  return getJson<Manifest>(`${base}manifest.json`, { cache: "no-cache" });
}

export async function fetchBundle(base: string, manifest?: Manifest): Promise<Bundle | OffSeasonManifest> {
  const current = manifest ?? (await fetchManifest(base));
  if (current.schema !== SUPPORTED_SCHEMA) throw new Error(`unsupported data schema ${current.schema}`);
  if (current.week === null) return current;
  // Files are replaced together, so the generation time versions all of them.
  const file = (name: string) => `${base}${name}?v=${encodeURIComponent(current.generated_at)}`;
  const [directory, schedule, projections] = await Promise.all([
    getJson<Directory>(file(current.files.players)),
    getJson<ScheduledGame[]>(file(current.files.schedule)),
    getJson<ProjectionRow[]>(file(current.files.projections)),
  ]);
  return { manifest: current, directory, schedule, projections };
}

/** "3 hours ago", for showing how old the projections are. */
export function age(iso: string | null, now = Date.now()): { text: string; hours: number } | null {
  const then = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(then)) return null;
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  const hours = minutes / 60;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (minutes < 1) return { text: "just now", hours };
  if (minutes < 60) return { text: plural(minutes, "minute"), hours };
  if (hours < 48) return { text: plural(Math.round(hours), "hour"), hours };
  return { text: plural(Math.round(hours / 24), "day"), hours };
}
