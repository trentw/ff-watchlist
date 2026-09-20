/**
 * Import a lineup from Sleeper.
 *
 * Sleeper's read API is public and allows cross-origin requests, so these
 * calls go straight from the visitor's browser to Sleeper. Player ids are the
 * same ids the player directory uses.
 */

import type { Scoring } from "./core.ts";
import type { Directory } from "./lineup.ts";
import type { RosterEntry } from "./roster.ts";

const API = "https://api.sleeper.app/v1";
const STORAGE_KEY = "ff-watchlist.sleeper";
const EMPTY_SLOT = "0";
const SLOT_LABELS: Record<string, string> = { DEF: "DST", SUPER_FLEX: "SFLEX", REC_FLEX: "W/T", WRRB_FLEX: "W/R" };

export type FetchJson = (url: string) => Promise<unknown>;

export interface SleeperLeague {
  id: string;
  name: string;
  teams: number;
  /** Lineup slots in order, bench excluded, e.g. ["QB", "RB", "RB", "FLEX"]. */
  starterSlots: string[];
  pointsPerReception: number;
}

export interface SleeperAccount {
  userId: string;
  username: string;
  leagues: SleeperLeague[];
}

export interface ImportedLineup {
  entries: RosterEntry[];
  scoring: Scoring;
  /** False when the league's reception points are not one of the three presets. */
  scoringIsPreset: boolean;
  /** Rostered players the directory does not cover, such as defensive players. */
  skipped: number;
}

/** What to re-import from next week without asking again. */
export interface SleeperSource {
  username: string;
  userId: string;
  leagueId: string;
  leagueName: string;
  importedAt: string;
}

export class SleeperError extends Error {}

const defaultFetch: FetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new SleeperError(`Sleeper answered ${response.status}.`);
  return response.json();
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function league(value: unknown): SleeperLeague | null {
  const row = record(value);
  if (!row || typeof row.league_id !== "string") return null;
  const perReception = Number(record(row.scoring_settings)?.rec ?? 0);
  return {
    id: row.league_id,
    name: typeof row.name === "string" && row.name ? row.name : "Unnamed league",
    teams: Number(row.total_rosters) || 0,
    starterSlots: strings(row.roster_positions).filter((slot) => slot !== "BN").map((slot) => SLOT_LABELS[slot] ?? slot),
    pointsPerReception: Number.isFinite(perReception) ? perReception : 0,
  };
}

export async function findAccount(username: string, season: number, fetchJson: FetchJson = defaultFetch): Promise<SleeperAccount> {
  const name = username.trim();
  if (!/^[\w.-]{1,40}$/.test(name)) throw new SleeperError("Enter a Sleeper username.");
  const user = record(await fetchJson(`${API}/user/${encodeURIComponent(name)}`));
  if (!user || typeof user.user_id !== "string") throw new SleeperError(`Sleeper has no user named “${name}”.`);
  const leagues = await fetchJson(`${API}/user/${user.user_id}/leagues/nfl/${season}`);
  return {
    userId: user.user_id,
    username: name,
    leagues: (Array.isArray(leagues) ? leagues : []).map(league).filter((l): l is SleeperLeague => l !== null),
  };
}

function presetFor(pointsPerReception: number): { scoring: Scoring; exact: boolean } {
  const presets: [number, Scoring][] = [[0, "std"], [0.5, "half"], [1, "ppr"]];
  const [value, scoring] = presets.reduce((best, next) =>
    Math.abs(next[0] - pointsPerReception) < Math.abs(best[0] - pointsPerReception) ? next : best);
  return { scoring, exact: value === pointsPerReception };
}

/**
 * Read one team's lineup for `week`. Starters come from that week's matchup
 * when Sleeper has one, otherwise from the roster's current starters.
 */
export async function importLineup(
  source: { userId: string; league: SleeperLeague }, week: number, directory: Directory, fetchJson: FetchJson = defaultFetch,
): Promise<ImportedLineup> {
  const { userId, league: from } = source;
  const [rosters, matchups] = await Promise.all([
    fetchJson(`${API}/league/${from.id}/rosters`),
    fetchJson(`${API}/league/${from.id}/matchups/${week}`).catch(() => []),
  ]);
  const roster = (Array.isArray(rosters) ? rosters : []).map(record)
    .find((r) => r && (r.owner_id === userId || strings(r.co_owners).includes(userId)));
  if (!roster) throw new SleeperError(`You don’t have a team in ${from.name}.`);
  const matchup = (Array.isArray(matchups) ? matchups : []).map(record).find((m) => m?.roster_id === roster.roster_id);

  const weekStarters = strings(matchup?.starters);
  const starters = weekStarters.some((id) => id !== EMPTY_SLOT) ? weekStarters : strings(roster.starters);
  const slotOf = new Map<string, string>();
  starters.forEach((id, i) => { if (id !== EMPTY_SLOT) slotOf.set(id, from.starterSlots[i] ?? "FLEX"); });
  for (const id of strings(roster.reserve)) if (!slotOf.has(id)) slotOf.set(id, "IR");
  for (const id of strings(roster.taxi)) if (!slotOf.has(id)) slotOf.set(id, "TAXI");
  for (const id of strings(matchup?.players).concat(strings(roster.players))) if (!slotOf.has(id)) slotOf.set(id, "BN");

  const entries: RosterEntry[] = [];
  let skipped = 0;
  for (const [id, slot] of slotOf) {
    if (directory[id]) entries.push({ id, slot });
    else skipped++;
  }
  if (!entries.length) throw new SleeperError(`Your team in ${from.name} has no players yet.`);
  const { scoring, exact } = presetFor(from.pointsPerReception);
  return { entries, scoring, scoringIsPreset: exact, skipped };
}

export function loadSource(storage: Pick<Storage, "getItem"> | undefined): SleeperSource | null {
  try {
    const saved = record(JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null"));
    const fields = ["username", "userId", "leagueId", "leagueName", "importedAt"] as const;
    return saved && fields.every((f) => typeof saved[f] === "string") ? (saved as unknown as SleeperSource) : null;
  } catch {
    return null;
  }
}

export function saveSource(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, source: SleeperSource | null): void {
  try {
    if (source) storage?.setItem(STORAGE_KEY, JSON.stringify(source));
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // The import itself still worked; only the shortcut for next week is lost.
  }
}
