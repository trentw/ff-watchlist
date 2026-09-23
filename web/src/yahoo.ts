/** Yahoo roster import: same-origin API plus explicit, local player matching. */
import { canonTeam, normName } from "./core.ts";
import type { Scoring } from "./core.ts";
import type { Directory } from "./lineup.ts";
import type { RosterEntry } from "./roster.ts";

export interface YahooTeam { key: string; leagueKey: string; name: string; leagueName: string }
export interface YahooPlayer { yahooId: string; name: string; team: string; position: string; slot: string }
export interface YahooRoster {
  season: number; week: number; team: YahooTeam; fetchedAt: string;
  players: YahooPlayer[]; pointsPerReception: number | null;
}
export interface YahooSource { teamKey: string; leagueName: string; teamName: string; importedAt: string }
export interface YahooMapped { entries: RosterEntry[]; issues: string[]; suggestedScoring: Scoring | null }

const STORAGE_KEY = "ff-watchlist.yahoo";
const STARTERS = new Set(["QB", "RB", "WR", "TE", "K", "DST", "FLEX", "W/R", "W/T", "W/R/T", "Q/W/R/T", "SUPERFLEX", "SFLEX"]);
const BENCH = new Set(["BN", "IR", "IR+", "NA", "RES", "RESERVE"]);
const API = "/api/yahoo";

export class YahooImportError extends Error {}

async function get<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`${API}/${path}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin",
  } : { credentials: "same-origin", cache: "no-store" });
  const result = await response.json() as T & { error?: { code: string } };
  if (!response.ok) {
    const messages: Record<string, string> = {
      reconnect_required: "Your Yahoo connection expired. Connect again.",
      yahoo_disabled: "Yahoo import is temporarily unavailable.",
      yahoo_unavailable: "Yahoo is unavailable right now. Your lineup is unchanged.",
      yahoo_rate_limited: "Yahoo is busy. Try again shortly.",
      week_changed: "The displayed week changed. Reload before importing.",
      roster_empty: "This team has no players for the displayed week.",
      roster_unavailable: "Yahoo has no roster for the displayed week yet.",
      season_unavailable: "This NFL season is not available in Yahoo.",
      not_your_team: "That team is no longer among your Yahoo teams.",
    };
    const code = result.error?.code ?? "unknown_error";
    throw new YahooImportError(messages[code] ?? `Yahoo import couldn't finish (${code}). Your lineup is unchanged.`);
  }
  return result;
}

export function session() { return get<{ enabled: boolean; connected: boolean; expiresAt?: string }>("session"); }
export async function connect(): Promise<string> { return (await get<{ authorizeUrl: string }>("connect", {})).authorizeUrl; }
export async function teams(): Promise<YahooTeam[]> { return (await get<{ teams: YahooTeam[] }>("teams")).teams; }
export function fetchRoster(teamKey: string, season: number, week: number) { return get<YahooRoster>("import", { teamKey, season, week }); }
export async function disconnect() { await get("disconnect", {}); }

function normalizeId(value: string): string {
  return /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : "";
}

function slot(raw: string): string | null {
  const upper = raw.trim().toUpperCase().replaceAll("D/ST", "DST");
  if (upper === "DEF") return "DST";
  if (BENCH.has(upper)) return upper === "RESERVE" || upper === "RES" ? "BN" : upper;
  return STARTERS.has(upper) ? upper : null;
}

function position(raw: string): string { return raw.toUpperCase().replaceAll("D/ST", "DST").replaceAll("DEF", "DST"); }

export function mapRoster(imported: YahooRoster, directory: Directory): YahooMapped {
  const byId = new Map<string, string[]>();
  for (const [id, row] of Object.entries(directory)) {
    const yahooId = row.yahoo_id ? normalizeId(row.yahoo_id) : "";
    if (yahooId) byId.set(yahooId, [...(byId.get(yahooId) ?? []), id]);
  }
  const entries: RosterEntry[] = [];
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const player of imported.players) {
    const name = player.name;
    const selected = slot(player.slot);
    const pos = position(player.position);
    if (!selected) { issues.push(`${name}: Yahoo slot “${player.slot}” needs review.`); continue; }
    if (!["QB", "RB", "WR", "TE", "K", "DST"].includes(pos)) {
      issues.push(`${name}: ${player.position || "unknown"} has no Watchlist projection.`); continue;
    }
    const yahooId = normalizeId(player.yahooId);
    let matches = yahooId ? byId.get(yahooId) ?? [] : [];
    if (!matches.length) {
      const team = canonTeam(player.team);
      matches = Object.entries(directory).filter(([, row]) => row.position === pos && canonTeam(row.team) === team &&
        (pos === "DST" || normName(row.name) === normName(name))).map(([id]) => id);
    }
    if (matches.length !== 1) { issues.push(`${name}: ${matches.length ? "ambiguous" : "not found"} in the player directory.`); continue; }
    const id = matches[0]!;
    const row = directory[id]!;
    if (row.position !== pos || canonTeam(row.team) !== canonTeam(player.team)) {
      issues.push(`${name}: Yahoo and the player directory disagree on team or position.`); continue;
    }
    if (seen.has(id)) { issues.push(`${name}: duplicate player in Yahoo roster.`); continue; }
    seen.add(id);
    entries.push({ id, slot: selected });
  }
  const ppr = imported.pointsPerReception;
  const suggestedScoring: Scoring | null = ppr === 0 ? "std" : ppr === 0.5 ? "half" : ppr === 1 ? "ppr" : null;
  return { entries, issues, suggestedScoring };
}

export function loadYahooSource(storage: Pick<Storage, "getItem"> | undefined): YahooSource | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const row = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    return row && ["teamKey", "leagueName", "teamName", "importedAt"].every((key) => typeof row[key] === "string")
      ? row as unknown as YahooSource : null;
  } catch { return null; }
}

export function saveYahooSource(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, source: YahooSource | null): void {
  try { if (source) storage?.setItem(STORAGE_KEY, JSON.stringify(source)); else storage?.removeItem(STORAGE_KEY); }
  catch { /* The active lineup remains usable without this shortcut. */ }
}
