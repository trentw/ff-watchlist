/** Read-only, bounded Yahoo Fantasy API adapter. No provider response is persisted. */

export class YahooError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

const API = "https://fantasysports.yahooapis.com/fantasy/v2";
const MAX_BYTES = 1024 * 1024;
const TEAM_KEY = /^\d+\.l\.\d+\.t\.\d+$/;
const LEAGUE_KEY = /^\d+\.l\.\d+$/;

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function text(value) { return typeof value === "string" ? value : ""; }
function fields(value) {
  if (!Array.isArray(value)) return object(value) ? [value] : [];
  return value.flatMap((row) => Array.isArray(row) ? row.map(object).filter(Boolean) : object(row) ? [row] : []);
}
function merged(value) { return Object.assign({}, ...fields(value)); }

function numbered(container, key) {
  const parent = object(container);
  const rows = parent && object(parent[key]);
  if (!rows) return [];
  return Object.entries(rows).filter(([index]) => /^\d+$/.test(index)).map(([, row]) => row);
}

function pair(container, name) {
  if (Array.isArray(container)) return fields(container).find((row) => name in row)?.[name];
  return object(container)?.[name];
}

export async function fantasyGet(accessToken, path, fetcher = fetch) {
  if (!path.startsWith("/") || path.includes("..")) throw new YahooError("bad_request", 400);
  const response = await fetcher(`${API}${path}${path.includes("?") ? "&" : "?"}format=json`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401) throw new YahooError("yahoo_unauthorized", 401);
  if (response.status === 403) throw new YahooError("yahoo_forbidden", 403);
  if (response.status === 429) throw new YahooError("yahoo_rate_limited", 429);
  if (!response.ok) throw new YahooError("yahoo_unavailable");
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_BYTES) throw new YahooError("yahoo_response_too_large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new YahooError("yahoo_response_too_large");
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new YahooError("yahoo_invalid_response"); }
}

/** Yahoo JSON wraps collections in numbered properties and resources in arrays. */
export function readGame(payload, season) {
  const games = object(object(payload)?.fantasy_content)?.games;
  if (!object(games)) throw new YahooError("yahoo_invalid_response");
  const matches = numbered({ games }, "games").map((row) => merged(object(row)?.game));
  const game = matches.find((row) => String(row?.season) === String(season));
  if (!game || !/^\d+$/.test(String(game.game_key))) throw new YahooError("season_unavailable", 404);
  return String(game.game_key);
}

export function readTeams(payload, gameKey) {
  const users = object(object(payload)?.fantasy_content)?.users;
  if (!object(users)) throw new YahooError("yahoo_invalid_response");
  const result = [];
  for (const userRow of numbered({ users }, "users")) {
    const user = object(userRow)?.user;
    const games = pair(user, "games");
    for (const gameRow of numbered({ games }, "games")) {
      const game = object(gameRow)?.game;
      const teams = pair(game, "teams");
      for (const teamRow of numbered({ teams }, "teams")) {
        const data = object(teamRow)?.team;
        const info = merged(data);
        const key = text(info?.team_key);
        if (!TEAM_KEY.test(key) || !key.startsWith(`${gameKey}.l.`)) continue;
        const leagueKey = key.replace(/\.t\.\d+$/, "");
        result.push({ key, leagueKey, name: text(info?.name) || "Unnamed team" });
      }
    }
  }
  return [...new Map(result.map((row) => [row.key, row])).values()];
}

export function readLeagueName(payload, leagueKey) {
  const league = object(object(payload)?.fantasy_content)?.league;
  const info = merged(league);
  if (!info || info.league_key !== leagueKey) throw new YahooError("yahoo_invalid_response");
  return text(info.name) || "Unnamed league";
}

export function readRoster(payload, teamKey, week) {
  const team = object(object(payload)?.fantasy_content)?.team;
  const info = merged(team);
  if (!info || info.team_key !== teamKey) throw new YahooError("yahoo_invalid_response");
  const roster = pair(team, "roster");
  // Yahoo's JSON conversion can put the default players sub-resource under
  // roster["0"] while leaving week and coverage fields beside it.
  const players = pair(roster, "players") ?? pair(pair(roster, "0"), "players");
  if (!object(players)) throw new YahooError("roster_unavailable", 404);
  const result = [];
  for (const row of numbered({ players }, "players")) {
    const player = object(row)?.player;
    const playerFields = fields(player);
    const get = (key) => playerFields.find((field) => key in field)?.[key];
    const id = String(get("player_id") ?? "");
    const name = text(object(get("name"))?.full);
    const selected = merged(get("selected_position"));
    const slot = text(selected?.position);
    if (!/^\d+$/.test(id) || !name || !slot) throw new YahooError("yahoo_invalid_response");
    if (selected.week != null && Number(selected.week) !== week) throw new YahooError("week_changed", 409);
    result.push({ yahooId: id, name, team: text(get("editorial_team_abbr")), position: text(get("primary_position")), slot });
  }
  if (!result.length) throw new YahooError("roster_empty", 404);
  if (result.length > 40) throw new YahooError("roster_too_large", 409);
  return result;
}

export function readReception(payload) {
  const league = object(object(payload)?.fantasy_content)?.league;
  const settings = pair(league, "settings");
  const modifiers = object(pair(settings, "stat_modifiers"))?.stats;
  const stats = numbered({ stats: modifiers }, "stats");
  for (const row of stats) {
    const stat = object(row)?.stat;
    if (String(object(stat)?.stat_id) === "11") {
      const n = Number(object(stat)?.value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export function validTeamKey(key) { return TEAM_KEY.test(key); }
export function validLeagueKey(key) { return LEAGUE_KEY.test(key); }
