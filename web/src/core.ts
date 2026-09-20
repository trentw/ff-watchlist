/**
 * Watchlist ranking for the browser.
 *
 * Mirrors `ff_watchlist.watch_core`: starter points rank games inside a
 * kickoff window, bench points only break ties, and a missing projection is
 * never treated as zero. `tests/parity/rank_cases.json` holds both in step.
 */

export type Scoring = "std" | "half" | "ppr";

export interface Player {
  name: string;
  team: string;
  pos: string;
  slot: string;
  proj?: number | null;
  jersey?: string | null;
}

export interface ProjectionRow {
  name: string;
  team_id: string | null;
  position_id: string;
  stats: Record<string, unknown>;
}

export interface ScheduledGame {
  away: string;
  home: string;
  kick_utc: string;
  network: string;
}

export interface RankedGame {
  away: string;
  home: string;
  /** Kickoff instant, ISO 8601 in UTC. */
  kick: string;
  network: string;
  starters: Player[];
  bench: Player[];
  starter_pts: number;
  bench_pts: number;
}

export interface KickoffWindow {
  /** Stable identifier: the UTC hour the window opens. */
  id: string;
  label: string;
  games: RankedGame[];
}

export interface Ranking {
  windows: KickoffWindow[];
  /** On bye, or on a team with no scheduled game. */
  idle: Player[];
  unmatched: Player[];
}

const SCORING_COLUMN: Record<Scoring, string> = { std: "points", half: "points_half", ppr: "points_ppr" };
const BENCH_SLOTS = new Set(["BN", "BENCH", "IR", "IR+", "NA", "RES", "TAXI"]);
const TEAM_ALIAS: Record<string, string> = { WSH: "WAS", JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR" };
const HOUR_MS = 3_600_000;

export function canonTeam(team: string | null | undefined): string {
  const code = (team ?? "").trim().toUpperCase();
  return TEAM_ALIAS[code] ?? code;
}

export function normName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}

export function isStarter(player: Player): boolean {
  return !BENCH_SLOTS.has(player.slot.trim().toUpperCase());
}

function finitePoints(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const points = Number(raw);
  return Number.isFinite(points) ? points : null;
}

/**
 * Set `proj` on each player for the chosen scoring and return the players
 * left without one. A scoring column is never substituted for another.
 */
export function attachProjections(players: Player[], rows: ProjectionRow[], scoring: Scoring): Player[] {
  const column = SCORING_COLUMN[scoring];
  const byIdentity = new Map<string, number>();
  const identitiesByName = new Map<string, Set<string>>();
  const defenseByTeam = new Map<string, number>();
  for (const row of rows) {
    const points = finitePoints(row.stats?.[column]);
    if (points === null) continue;
    const team = canonTeam(row.team_id);
    if (row.position_id === "DST") {
      defenseByTeam.set(team, points);
      continue;
    }
    const name = normName(row.name);
    const identity = `${name}|${team}`;
    byIdentity.set(identity, points);
    identitiesByName.set(name, (identitiesByName.get(name) ?? new Set()).add(identity));
  }

  const unmatched: Player[] = [];
  for (const player of players) {
    const team = canonTeam(player.team);
    if (player.pos === "DST") {
      player.proj = defenseByTeam.get(team) ?? null;
    } else {
      const name = normName(player.name);
      const sameName = [...(identitiesByName.get(name) ?? [])];
      // A traded player may be listed under an old team; accept the name
      // alone only when it identifies exactly one projected player.
      const identity = byIdentity.has(`${name}|${team}`) ? `${name}|${team}` : sameName.length === 1 ? sameName[0]! : null;
      player.proj = identity === null ? null : byIdentity.get(identity)!;
    }
    if (player.proj === null) unmatched.push(player);
  }
  return unmatched;
}

function byPointsDescending(a: Player, b: Player): number {
  return (b.proj ?? 0) - (a.proj ?? 0);
}

function total(players: Player[]): number {
  return players.reduce((sum, player) => sum + (player.proj ?? 0), 0);
}

/** Label a kickoff window for display, e.g. "Sun 1pm". */
export function windowLabel(kick: string | number | Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", hour12: true, timeZone })
    .formatToParts(new Date(kick));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("hour")}${part("dayPeriod").toLowerCase()}`;
}

/**
 * Group the schedule into kickoff windows and rank the games in each.
 *
 * Windows are keyed by UTC hour, so 1:05 and 1:25 kickoffs compete with each
 * other whatever timezone the viewer is in; `timeZone` only affects labels.
 */
export function rank(players: Player[], schedule: ScheduledGame[], timeZone?: string): Ranking {
  for (const player of players) {
    if (player.proj != null && !Number.isFinite(player.proj)) throw new RangeError("Projection points must be finite");
  }
  const games = schedule.map((game) => ({
    away: canonTeam(game.away),
    home: canonTeam(game.home),
    kickMs: Date.parse(game.kick_utc),
    network: game.network,
    starters: [] as Player[],
    bench: [] as Player[],
  }));

  const idle: Player[] = [];
  for (const player of players) {
    const team = canonTeam(player.team);
    const game = games.find((g) => g.away === team || g.home === team);
    if (!game) idle.push(player);
    else (isStarter(player) ? game.starters : game.bench).push(player);
  }

  const windows = new Map<number, RankedGame[]>();
  for (const game of [...games].sort((a, b) => a.kickMs - b.kickMs)) {
    game.starters.sort(byPointsDescending);
    game.bench.sort(byPointsDescending);
    const hour = Math.floor(game.kickMs / HOUR_MS);
    const { kickMs, ...rest } = game;
    const ranked: RankedGame = {
      ...rest,
      kick: new Date(kickMs).toISOString(),
      starter_pts: total(game.starters),
      bench_pts: total(game.bench),
    };
    windows.set(hour, [...(windows.get(hour) ?? []), ranked]);
  }

  return {
    windows: [...windows.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hour, inWindow]) => {
        const ordered = [...inWindow].sort((a, b) =>
          b.starter_pts - a.starter_pts || b.bench_pts - a.bench_pts || Date.parse(a.kick) - Date.parse(b.kick));
        return { id: new Date(hour * HOUR_MS).toISOString(), label: windowLabel(ordered[0]!.kick, timeZone), games: ordered };
      }),
    idle,
    unmatched: players.filter((player) => player.proj == null),
  };
}
