/**
 * The visitor's lineup: kept in this browser only, and encodable as a share link.
 */

import type { Scoring } from "./core.ts";
import type { Directory, LineupPlayer } from "./lineup.ts";

export interface RosterEntry {
  id: string;
  slot: string;
  /** The player's team when the lineup was last confirmed. */
  team?: string;
}

export interface Roster {
  version: 1;
  scoring: Scoring;
  entries: RosterEntry[];
  /** The week the visitor last edited or confirmed this lineup, e.g. "2026-3". */
  confirmed?: string;
}

export interface TeamChange {
  name: string;
  from: string;
  to: string;
}

const STORAGE_KEY = "ff-watchlist.roster";
const SCORINGS: readonly string[] = ["std", "half", "ppr"];
const MAX_ENTRIES = 40;

export function emptyRoster(): Roster {
  return { version: 1, scoring: "half", entries: [] };
}

function validRoster(value: unknown): Roster | null {
  if (typeof value !== "object" || value === null) return null;
  const { version, scoring, entries, confirmed } = value as Record<string, unknown>;
  if (version !== 1 || typeof scoring !== "string" || !SCORINGS.includes(scoring) || !Array.isArray(entries)) return null;
  const clean: RosterEntry[] = [];
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    if (typeof entry?.id === "string" && typeof entry?.slot === "string" && !clean.some((e) => e.id === entry.id)) {
      clean.push({ id: entry.id, slot: entry.slot, ...(typeof entry.team === "string" ? { team: entry.team } : {}) });
    }
  }
  const roster: Roster = { version: 1, scoring: scoring as Scoring, entries: clean };
  if (typeof confirmed === "string") roster.confirmed = confirmed;
  return roster;
}

/** Storage can be unavailable (private browsing, blocked cookies); the app still works without it. */
export function loadRoster(storage: Pick<Storage, "getItem"> | undefined): Roster | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? validRoster(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveRoster(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, roster: Roster): boolean {
  try {
    if (roster.entries.length) storage?.setItem(STORAGE_KEY, JSON.stringify(roster));
    else storage?.removeItem(STORAGE_KEY);
    return storage !== undefined;
  } catch {
    return false;
  }
}

/** `#s=ppr&p=4034.QB,4866.BN`: ids and slots only, so a link never carries more than the lineup. */
export function encodeShare(roster: Roster): string {
  const players = roster.entries.map((e) => `${encodeURIComponent(e.id)}.${encodeURIComponent(e.slot)}`).join(",");
  return `s=${roster.scoring}&p=${players}`;
}

export function decodeShare(hash: string): Roster | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const players = params.get("p");
  if (!players) return null;
  const entries = players.split(",").map((pair) => {
    const dot = pair.indexOf(".");
    return dot < 1 ? null : { id: decodeURIComponent(pair.slice(0, dot)), slot: decodeURIComponent(pair.slice(dot + 1)) };
  });
  if (entries.some((e) => e === null)) return null;
  return validRoster({ version: 1, scoring: params.get("s") ?? "half", entries });
}

/** Resolve saved ids against today's directory; players who have left it are returned separately. */
export function resolveRoster(roster: Roster, directory: Directory): { players: LineupPlayer[]; missing: RosterEntry[] } {
  const players: LineupPlayer[] = [];
  const missing: RosterEntry[] = [];
  for (const entry of roster.entries) {
    const found = directory[entry.id];
    if (!found) { missing.push(entry); continue; }
    const player: LineupPlayer = { id: entry.id, name: found.name, team: found.team, pos: found.position, slot: entry.slot };
    if (found.number !== undefined) player.jersey = found.number;
    players.push(player);
  }
  return { players, missing };
}

export function weekKey(season: number, week: number): string {
  return `${season}-${week}`;
}

/** A lineup saved in an earlier week is not necessarily this week's lineup. */
export function needsReview(roster: Roster, currentWeek: string): boolean {
  return roster.entries.length > 0 && roster.confirmed !== currentWeek;
}

/** Record that the lineup is right for this week, with each player's current team. */
export function confirmRoster(roster: Roster, directory: Directory, currentWeek: string): Roster {
  const entries = roster.entries.map(({ id, slot }) => {
    const team = directory[id]?.team;
    return team ? { id, slot, team } : { id, slot };
  });
  return { ...roster, entries, confirmed: currentWeek };
}

/** Players whose team differs from the one recorded when the lineup was confirmed. */
export function teamChanges(roster: Roster, directory: Directory): TeamChange[] {
  const changes: TeamChange[] = [];
  for (const entry of roster.entries) {
    const now = directory[entry.id];
    if (now && entry.team !== undefined && entry.team !== now.team) {
      changes.push({ name: now.name, from: entry.team || "free agency", to: now.team || "free agency" });
    }
  }
  return changes;
}
