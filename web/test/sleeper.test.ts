import assert from "node:assert/strict";
import { test } from "node:test";

import { SleeperError, findAccount, importLineup, loadSource, saveSource } from "../src/sleeper.ts";
import type { FetchJson, SleeperLeague, SleeperSource } from "../src/sleeper.ts";
import type { Directory } from "../src/lineup.ts";

const API = "https://api.sleeper.app/v1";

const directory: Directory = {
  "11": { name: "Pat Passer", team: "BUF", position: "QB" },
  "22": { name: "Rex Runner", team: "DET", position: "RB" },
  "33": { name: "Will Wideout", team: "MIN", position: "WR" },
  "44": { name: "Ben Bench", team: "CHI", position: "WR" },
  "55": { name: "Ian Injured", team: "KC", position: "TE" },
  "66": { name: "Tex Taxi", team: "SEA", position: "RB" },
  CHI: { name: "Chicago Bears", team: "CHI", position: "DST" },
};

const leagueRow = {
  league_id: "L1", name: "Work Friends", total_rosters: 10,
  roster_positions: ["QB", "RB", "FLEX", "DEF", "BN", "BN", "BN"],
  scoring_settings: { rec: 0.5, pass_td: 4 },
};
const league: SleeperLeague = { id: "L1", name: "Work Friends", teams: 10, starterSlots: ["QB", "RB", "FLEX", "DST"], pointsPerReception: 0.5 };

const mine = {
  roster_id: 7, owner_id: "U1", co_owners: null,
  starters: ["11", "22", "44", "CHI"],
  players: ["11", "22", "33", "44", "55", "66", "CHI", "9001"],
  reserve: ["55"], taxi: ["66"],
};
const theirs = { roster_id: 2, owner_id: "U2", starters: ["33"], players: ["33"], reserve: null, taxi: null };

function fake(responses: Record<string, unknown>): FetchJson & { calls: string[] } {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url);
    if (!(url in responses)) throw new SleeperError(`unexpected request ${url}`);
    return responses[url];
  };
  return Object.assign(fetchJson, { calls });
}

test("a username leads to that season's leagues", async () => {
  const fetchJson = fake({
    [`${API}/user/sam_w`]: { user_id: "U1", username: "sam_w" },
    [`${API}/user/U1/leagues/nfl/2026`]: [leagueRow, { name: "no id" }, null],
  });
  const account = await findAccount("  sam_w ", 2026, fetchJson);
  assert.deepEqual(account, { userId: "U1", username: "sam_w", leagues: [league] });
});

test("unknown and malformed usernames are explained without a second request", async () => {
  const fetchJson = fake({ [`${API}/user/nobody`]: null });
  await assert.rejects(findAccount("nobody", 2026, fetchJson), /no user named “nobody”/);
  await assert.rejects(findAccount("a/../b", 2026, fetchJson), /Enter a Sleeper username/);
  await assert.rejects(findAccount("", 2026, fetchJson), SleeperError);
  assert.deepEqual(fetchJson.calls, [`${API}/user/nobody`]);
});

test("the week's matchup decides who starts, and slots follow the league's order", async () => {
  const fetchJson = fake({
    [`${API}/league/L1/rosters`]: [theirs, mine],
    [`${API}/league/L1/matchups/3`]: [{ roster_id: 7, starters: ["11", "22", "33", "0"], players: mine.players }],
  });
  const lineup = await importLineup({ userId: "U1", league }, 3, directory, fetchJson);
  assert.deepEqual(lineup.entries, [
    { id: "11", slot: "QB" }, { id: "22", slot: "RB" }, { id: "33", slot: "FLEX" },
    { id: "55", slot: "IR" }, { id: "66", slot: "TAXI" }, { id: "44", slot: "BN" }, { id: "CHI", slot: "BN" },
  ]);
  assert.deepEqual([lineup.scoring, lineup.scoringIsPreset, lineup.skipped], ["half", true, 1]);
});

test("without a matchup the roster's current starters are used", async () => {
  const fetchJson = fake({ [`${API}/league/L1/rosters`]: [mine], [`${API}/league/L1/matchups/3`]: [] });
  const lineup = await importLineup({ userId: "U1", league }, 3, directory, fetchJson);
  assert.deepEqual(lineup.entries.slice(0, 4), [
    { id: "11", slot: "QB" }, { id: "22", slot: "RB" }, { id: "44", slot: "FLEX" }, { id: "CHI", slot: "DST" },
  ]);

  const failing: FetchJson = async (url) => {
    if (url.includes("/matchups/")) throw new SleeperError("down");
    return [mine];
  };
  assert.equal((await importLineup({ userId: "U1", league }, 3, directory, failing)).entries.length, 7);
});

test("co-owners can import, strangers and empty teams are told why not", async () => {
  const shared = { ...theirs, co_owners: ["U9"] };
  const fetchJson = fake({ [`${API}/league/L1/rosters`]: [shared, { ...mine, players: [], starters: [], reserve: [], taxi: [] }], [`${API}/league/L1/matchups/1`]: [] });
  assert.deepEqual((await importLineup({ userId: "U9", league }, 1, directory, fetchJson)).entries, [{ id: "33", slot: "QB" }]);
  await assert.rejects(importLineup({ userId: "U404", league }, 1, directory, fetchJson), /don’t have a team in Work Friends/);
  await assert.rejects(importLineup({ userId: "U1", league }, 1, directory, fetchJson), /no players yet/);
});

test("unusual reception scoring maps to the nearest preset and says so", async () => {
  const fetchJson = fake({ [`${API}/league/L1/rosters`]: [mine], [`${API}/league/L1/matchups/1`]: [] });
  const custom = await importLineup({ userId: "U1", league: { ...league, pointsPerReception: 0.75 } }, 1, directory, fetchJson);
  assert.deepEqual([custom.scoring, custom.scoringIsPreset], ["half", false]);
  const full = await importLineup({ userId: "U1", league: { ...league, pointsPerReception: 1 } }, 1, directory, fetchJson);
  assert.deepEqual([full.scoring, full.scoringIsPreset], ["ppr", true]);
});

test("the import source is remembered only when complete", () => {
  const items = new Map<string, string>();
  const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
  const source: SleeperSource = { username: "sam_w", userId: "U1", leagueId: "L1", leagueName: "Work Friends", importedAt: "2026-09-20T12:00:00Z" };
  saveSource(storage, source);
  assert.deepEqual(loadSource(storage), source);
  items.set("ff-watchlist.sleeper", JSON.stringify({ username: "sam_w" }));
  assert.equal(loadSource(storage), null);
  saveSource(storage, null);
  assert.equal(items.size, 0);
  assert.equal(loadSource(undefined), null);
});
