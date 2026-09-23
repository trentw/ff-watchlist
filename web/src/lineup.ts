/**
 * Parse a pasted lineup against the player directory.
 *
 * Mirrors `ff_watchlist.watch_lineup`. Only exact normalized names resolve;
 * a name that could mean two players is reported, never guessed.
 * `tests/parity/lineup_cases.json` holds the two implementations in step.
 */

import { canonTeam, normName } from "./core.ts";
import type { Player } from "./core.ts";

export interface DirectoryEntry {
  name: string;
  team: string;
  position: string;
  number?: string;
  active?: boolean;
  yahoo_id?: string;
}

export type Directory = Record<string, DirectoryEntry>;

export interface LineupPlayer extends Player {
  id: string;
}

export interface LineupIssue {
  line: number;
  text: string;
  message: string;
}

export interface ParsedLineup {
  players: LineupPlayer[];
  issues: LineupIssue[];
}

interface ParsedLine {
  name: string;
  team: string;
  slot: string;
  position?: string;
  invalidTeam?: string;
  invalidSlot?: string;
}

interface DirectoryRow {
  id: string;
  name: string;
  norm: string;
  team: string;
  pos: string;
  number?: string;
  active: boolean | null;
}

const BENCH = ["BN", "BENCH", "IR", "IR+", "NA", "RES", "RESERVE", "TAXI"];
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST", "DEF"]);
const SLOTS = new Set([...POSITIONS, "FLEX", "W/R", "W/R/T", "RB/WR", "RB/WR/TE", "STARTER", ...BENCH]);

const TEAM_NAMES: Record<string, string> = {
  "ARIZONA": "ARI", "ARIZONA CARDINALS": "ARI", "CARDINALS": "ARI",
  "ATLANTA": "ATL", "ATLANTA FALCONS": "ATL", "FALCONS": "ATL",
  "BALTIMORE": "BAL", "BALTIMORE RAVENS": "BAL", "RAVENS": "BAL",
  "BUFFALO": "BUF", "BUFFALO BILLS": "BUF", "BILLS": "BUF",
  "CAROLINA": "CAR", "CAROLINA PANTHERS": "CAR", "PANTHERS": "CAR",
  "CHICAGO": "CHI", "CHICAGO BEARS": "CHI", "BEARS": "CHI",
  "CINCINNATI": "CIN", "CINCINNATI BENGALS": "CIN", "BENGALS": "CIN",
  "CLEVELAND": "CLE", "CLEVELAND BROWNS": "CLE", "BROWNS": "CLE",
  "DALLAS": "DAL", "DALLAS COWBOYS": "DAL", "COWBOYS": "DAL",
  "DENVER": "DEN", "DENVER BRONCOS": "DEN", "BRONCOS": "DEN",
  "DETROIT": "DET", "DETROIT LIONS": "DET", "LIONS": "DET",
  "GREEN BAY": "GB", "GREEN BAY PACKERS": "GB", "PACKERS": "GB",
  "HOUSTON": "HOU", "HOUSTON TEXANS": "HOU", "TEXANS": "HOU",
  "INDIANAPOLIS": "IND", "INDIANAPOLIS COLTS": "IND", "COLTS": "IND",
  "JACKSONVILLE": "JAX", "JACKSONVILLE JAGUARS": "JAX", "JAGUARS": "JAX",
  "KANSAS CITY": "KC", "KANSAS CITY CHIEFS": "KC", "CHIEFS": "KC",
  "LAS VEGAS": "LV", "LAS VEGAS RAIDERS": "LV", "RAIDERS": "LV",
  "LOS ANGELES": "LAR", "LOS ANGELES RAMS": "LAR", "RAMS": "LAR",
  "LOS ANGELES CHARGERS": "LAC", "CHARGERS": "LAC",
  "MIAMI": "MIA", "MIAMI DOLPHINS": "MIA", "DOLPHINS": "MIA",
  "MINNESOTA": "MIN", "MINNESOTA VIKINGS": "MIN", "VIKINGS": "MIN",
  "NEW ENGLAND": "NE", "NEW ENGLAND PATRIOTS": "NE", "PATRIOTS": "NE",
  "NEW ORLEANS": "NO", "NEW ORLEANS SAINTS": "NO", "SAINTS": "NO",
  "NEW YORK GIANTS": "NYG", "GIANTS": "NYG",
  "NEW YORK JETS": "NYJ", "JETS": "NYJ",
  "PHILADELPHIA": "PHI", "PHILADELPHIA EAGLES": "PHI", "EAGLES": "PHI",
  "PITTSBURGH": "PIT", "PITTSBURGH STEELERS": "PIT", "STEELERS": "PIT",
  "SAN FRANCISCO": "SF", "SAN FRANCISCO 49ERS": "SF", "49ERS": "SF",
  "SEATTLE": "SEA", "SEATTLE SEAHAWKS": "SEA", "SEAHAWKS": "SEA",
  "TAMPA BAY": "TB", "TAMPA BAY BUCCANEERS": "TB", "BUCCANEERS": "TB",
  "TENNESSEE": "TEN", "TENNESSEE TITANS": "TEN", "TITANS": "TEN",
  "WASHINGTON": "WAS", "WASHINGTON COMMANDERS": "WAS", "COMMANDERS": "WAS",
};
const TEAM_CODES = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LV", "LAR", "LAC", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS",
];
const TEAM_ALIASES: Record<string, string> = {
  ...TEAM_NAMES,
  ...Object.fromEntries(TEAM_CODES.map((code) => [code, code])),
  WSH: "WAS", JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR",
};
const KNOWN_TEAMS = new Set(Object.values(TEAM_ALIASES));
// Longest first, so LOS ANGELES CHARGERS wins over LOS ANGELES.
const ALIASES_LONGEST_FIRST = Object.keys(TEAM_ALIASES).sort((a, b) => b.length - a.length);

const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

export const TEAMS: readonly string[] = TEAM_CODES;

/** Full franchise name for a team code, e.g. "Chicago Bears". */
export function teamDisplayName(team: string): string {
  const names = Object.keys(TEAM_NAMES).filter((name) => TEAM_NAMES[name] === team && name.includes(" "));
  const longest = names.sort((a, b) => b.length - a.length)[0];
  return longest ? longest.replace(/[A-Za-z]+/g, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()) : team;
}

function teamCode(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase().replace(/\s+/g, " ");
  const code = TEAM_ALIASES[upper] ?? canonTeam(upper);
  return KNOWN_TEAMS.has(code) ? code : "";
}

function slotLabel(value: string | undefined): string {
  let raw = (value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  raw = raw.replaceAll("D/ST", "DST").replaceAll("DEFENSE", "DST").replaceAll("DEF", "DST");
  raw = raw.replace(/\s*[/|]\s*/g, "/");
  if (raw === "RES" || raw === "RESERVE") return "BN";
  return raw || "STARTER";
}

function position(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase().replaceAll("D/ST", "DST").replaceAll("DEF", "DST");
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] !== "#") return ENTITIES[body.toLowerCase()] ?? match;
    const code = body[1]!.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Reduce copied markup to its visible text; nothing pasted is ever rendered. */
function visibleText(line: string): string {
  const stripped = line
    .replace(/<\s*(script|style)\b[^>]*>.*?<\s*\/\s*\1\s*>/gis, " ")
    .replace(/<!--.*?-->/gs, " ")
    .replace(/<\s*(?:br|\/tr|\/p|\/li|\/div)\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

const HEADERS = new Set([
  "name team slot", "player team slot", "player team pos", "name team position",
  "slot name team", "position player team", "position name team", "starters",
  "starting lineup", "player", "roster", "lineup",
]);

function isHeader(line: string): boolean {
  return HEADERS.has(line.toLowerCase().replace(/[^a-z]+/g, " ").trim());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripChars(text: string, chars: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start]!)) start++;
  while (end > start && chars.includes(text[end - 1]!)) end--;
  return text.slice(start, end);
}

/** Find one team phrase and return it with the rest of the text. */
function teamIn(text: string): { team: string; remainder: string } | null {
  const upper = text.toUpperCase();
  for (const alias of ALIASES_LONGEST_FIRST) {
    const match = new RegExp(`(?<![A-Z0-9])${escapeRegExp(alias)}(?![A-Z0-9])`).exec(upper);
    if (match) {
      const remainder = `${text.slice(0, match.index)} ${text.slice(match.index + alias.length)}`.trim();
      return { team: TEAM_ALIASES[alias]!, remainder };
    }
  }
  return null;
}

function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") { fields.push(field); field = ""; }
    else field += char;
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

function parseCsvLine(fields: string[]): ParsedLine {
  const firstSlot = slotLabel(fields[0]);
  const leadingSlotTypo = fields.length >= 3 && !SLOTS.has(firstSlot) && teamCode(fields[2]) !== ""
    && /^[A-Z][A-Z/+]{1,8}$/.test(fields[0]!);
  let name: string;
  let rawTeam: string;
  let slot: string;
  let invalidSlot = "";
  if ((SLOTS.has(firstSlot) && fields.length >= 3) || leadingSlotTypo) {
    [name, rawTeam, slot] = [fields[1]!, fields[2]!, firstSlot];
    if (leadingSlotTypo) invalidSlot = fields[0]!;
  } else {
    [name, rawTeam] = [fields[0]!, fields[1]!];
    const rawSlot = fields[2] ?? "";
    slot = rawSlot ? slotLabel(rawSlot) : "STARTER";
    if (rawSlot && !SLOTS.has(slot)) invalidSlot = rawSlot;
  }
  const team = teamCode(rawTeam);
  const last = slotLabel(fields[fields.length - 1]);
  if (fields.length >= 4 && SLOTS.has(last)) slot = last;
  const parsed: ParsedLine = { name, team, slot };
  if (rawTeam && !team) parsed.invalidTeam = rawTeam;
  if (invalidSlot) parsed.invalidSlot = invalidSlot;
  return parsed;
}

function parseLine(line: string): ParsedLine | null {
  if (!line) return null;
  if (line.includes(",")) {
    const fields = csvFields(line);
    if (fields.length >= 2) return parseCsvLine(fields);
  }

  // A copied roster row: "QB  Caleb Williams  Chi - QB".
  const row = /^\s*(BN|BENCH|IR\+?|NA|RES|[A-Z][A-Z/+ -]*)\s+(.+?)\s+([A-Za-z .]+?)\s*-\s*([A-Za-z/+]+)\s*$/i.exec(line);
  if (row && SLOTS.has(slotLabel(row[1])) && teamCode(row[3])) {
    return { name: row[2]!.trim(), team: teamCode(row[3]), slot: slotLabel(row[1]), position: position(row[4]) };
  }

  let work = line.trim();
  let slot = "STARTER";
  const leading = /^(BN|BENCH|IR\+?|NA|RES|QB|RB|WR|TE|K|DEF|DST|FLEX|W\/R(?:\/T)?)\b\s+/i.exec(work);
  if (leading) {
    slot = slotLabel(leading[1]);
    work = work.slice(leading[0].length).trim();
  }
  const slotOr = (fallback: string) => (slot !== "STARTER" ? slot : fallback || "STARTER");

  // Pipe and dash separated copies have unambiguous columns.
  const parts = work.split(/\s*(?:\||\t|—|–)\s*/).map((p) => p.trim()).filter(Boolean);
  const lastPart = parts[parts.length - 1];
  if (parts.length >= 3 && teamCode(parts[parts.length - 2]) && POSITIONS.has(position(lastPart))) {
    return { name: parts[0]!, team: teamCode(parts[parts.length - 2]), slot: slotOr(position(lastPart)), position: position(lastPart) };
  }
  if (parts.length >= 2 && teamCode(lastPart)) {
    let pos = parts.length >= 3 ? position(parts[1]) : POSITIONS.has(parts[1]!.toUpperCase()) ? parts[1]! : "";
    if (pos && !POSITIONS.has(pos)) pos = "";
    return { name: parts[0]!, team: teamCode(lastPart), slot: slotOr(pos), position: pos };
  }

  // Drop a trailing "- QB", "(CHI) QB" or bare position, then look for a team.
  let pos = "";
  const tail = /(?:\s*-\s*|\s+|\()([A-Z][A-Z/+ ]{0,8})(?:\))?\s*$/i.exec(work);
  if (tail && POSITIONS.has(position(tail[1]))) {
    pos = position(tail[1]);
    work = stripChars(work.slice(0, tail.index), " -(");
  }
  const hit = teamIn(work);
  if (hit) {
    let name = stripChars(hit.remainder.replace(/[(),]/g, " ").trim(), " -");
    const upper = line.toUpperCase();
    // A defense is often written as just "Chicago Bears D/ST".
    if (!name || slot === "DST" || upper.includes("D/ST") || upper.includes("DEFENSE")) {
      name = stripChars(hit.remainder, " -") || teamDisplayName(hit.team);
    }
    return { name, team: hit.team, slot: slotOr(pos), position: pos };
  }
  return { name: stripChars(work, " ,"), team: "", slot: slotOr(pos), position: pos };
}

function slotOnly(line: string): string | null {
  const value = line.trim().toUpperCase();
  return SLOTS.has(value) ? slotLabel(value) : null;
}

/** The "CHI - QB" line that follows a player name in one-field-per-line copies. */
function isTeamPositionLine(line: string): boolean {
  const match = /^\s*(.+?)\s*-\s*([A-Za-z/+]+)\s*$/.exec(line);
  return !!match && teamCode(match[1]) !== "" && POSITIONS.has(position(match[2]));
}

function directoryRows(directory: Directory): DirectoryRow[] {
  return Object.entries(directory).map(([id, entry]) => {
    const team = teamCode(entry.team);
    const pos = position(entry.position);
    const name = (entry.name || (pos === "DST" && team ? teamDisplayName(team) : "")).trim();
    return { id, name, norm: normName(name), team, pos, number: entry.number, active: entry.active ?? null };
  });
}

/** Quote a value the way the Python parser's messages do. */
function quoted(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  return quote + text.replace(/\\/g, "\\\\").replaceAll(quote, `\\${quote}`) + quote;
}

/** Fold "slot / name / team - position" spread over lines into one line each. */
function logicalLines(text: string): [number, string][] {
  const lines = text.split(LINE_BREAK).map((raw, i): [number, string] => [i + 1, visibleText(raw)]);
  const folded: [number, string][] = [];
  for (let i = 0; i < lines.length; i++) {
    const [lineNo, visible] = lines[i]!;
    const marker = visible ? slotOnly(visible) : null;
    const next = lines[i + 1]?.[1];
    if (marker !== null && next && !isHeader(next) && slotOnly(next) === null) {
      let combined = `${marker} ${next}`;
      i++;
      const meta = lines[i + 1]?.[1];
      if (meta && isTeamPositionLine(meta)) {
        combined = `${combined} ${meta}`;
        i++;
      }
      folded.push([lineNo, combined]);
    } else {
      folded.push([lineNo, visible]);
    }
  }
  return folded;
}

export function parseLineup(text: string, directory: Directory): ParsedLineup {
  const result: ParsedLineup = { players: [], issues: [] };
  const rows = directoryRows(directory);
  const byName = new Map<string, DirectoryRow[]>();
  for (const row of rows) if (row.norm) byName.set(row.norm, [...(byName.get(row.norm) ?? []), row]);
  const seen = new Set<string>();

  for (const [line, visible] of logicalLines(text)) {
    if (!visible || isHeader(visible)) continue;
    const issue = (message: string) => result.issues.push({ line, text: visible, message });
    const parsed = parseLine(visible);
    if (!parsed?.name) { issue("could not parse a player line"); continue; }
    if (parsed.invalidTeam) { issue(`unknown team ${quoted(parsed.invalidTeam)}; use an NFL abbreviation or team name`); continue; }
    if (parsed.invalidSlot) { issue(`unknown lineup slot ${quoted(parsed.invalidSlot)}`); continue; }

    const slot = slotLabel(parsed.slot);
    const queryName = parsed.name.trim();
    const queryNorm = normName(queryName);
    const wantedPos = position(parsed.position) || (POSITIONS.has(slot) ? position(slot) : "");
    let hits = byName.get(queryNorm) ?? [];
    const activeHits = hits.filter((h) => h.active === true);
    if (parsed.team) {
      // An explicit old team must not quietly select a stale directory row.
      if (activeHits.length && !activeHits.some((h) => h.team === parsed.team)) {
        issue(`team ${parsed.team} conflicts with the player's active/current team`);
        continue;
      }
      hits = hits.filter((h) => h.team === parsed.team);
      if (!hits.length && queryNorm && wantedPos !== "DST") {
        issue(`team ${parsed.team} conflicts with the directory entry`);
        continue;
      }
    } else if (activeHits.length) {
      hits = activeHits;
    }

    if (wantedPos) {
      const samePosition = hits.filter((h) => h.pos === wantedPos);
      if (samePosition.length) hits = samePosition;
    }
    // A defense is usually named by its team rather than a directory name.
    if (!hits.length && wantedPos === "DST" && parsed.team) {
      hits = rows.filter((h) => h.team === parsed.team && h.pos === "DST");
    }
    if (!hits.length) {
      issue(`unmatched player name ${quoted(queryName)}; use the exact name or add a team`);
      continue;
    }
    if (hits.length !== 1) {
      const teams = [...new Set(hits.map((h) => h.team || "?"))].sort().join(", ");
      issue(`ambiguous player name ${quoted(queryName)} (${teams}); add the current team`);
      continue;
    }
    const hit = hits[0]!;
    if (seen.has(`${hit.id}|${hit.team}`)) {
      issue(`duplicate player ${quoted(hit.name || queryName)}; row ignored`);
      continue;
    }
    seen.add(`${hit.id}|${hit.team}`);
    const player: LineupPlayer = { id: hit.id, name: hit.name || queryName, team: hit.team || parsed.team, pos: hit.pos || wantedPos, slot };
    if (hit.number !== undefined && hit.number !== "") player.jersey = hit.number;
    result.players.push(player);
  }
  return result;
}
