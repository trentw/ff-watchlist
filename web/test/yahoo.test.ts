import assert from "node:assert/strict";
import { test } from "node:test";
import { mapRoster, loadYahooSource, saveYahooSource } from "../src/yahoo.ts";
import type { YahooRoster, YahooSource } from "../src/yahoo.ts";
import type { Directory } from "../src/lineup.ts";

const directory: Directory = {
  "123": { name: "Pat Passer", team: "BUF", position: "QB", yahoo_id: "9001" },
  "234": { name: "Rex Runner", team: "DET", position: "RB" },
  CHI: { name: "Chicago Bears", team: "CHI", position: "DST" },
  "345": { name: "Same Name", team: "SEA", position: "WR" },
  "456": { name: "Same Name", team: "SEA", position: "WR" },
};

function importedRoster(players: YahooRoster["players"], pointsPerReception: number | null = 0.5): YahooRoster {
  return { season: 2026, week: 3, team: { key: "1.l.2.t.3", leagueKey: "1.l.2", name: "My Team", leagueName: "A League" },
    fetchedAt: "2026-09-23T00:00:00Z", players, pointsPerReception };
}

test("Yahoo ID, exact fallback and defense map to local IDs with safe slots", () => {
  const imported = importedRoster([
    { yahooId: "9001", name: "Pat Passer", team: "BUF", position: "QB", slot: "QB" },
    { yahooId: "9002", name: "Rex Runner", team: "DET", position: "RB", slot: "BN" },
    { yahooId: "100003", name: "Chicago", team: "CHI", position: "DEF", slot: "DEF" },
  ]);
  assert.deepEqual(mapRoster(imported, directory), { entries: [
    { id: "123", slot: "QB" }, { id: "234", slot: "BN" }, { id: "CHI", slot: "DST" },
  ], issues: [], suggestedScoring: "half" });
});

test("ambiguity, unsupported positions and mismatched teams are left for review", () => {
  const imported = importedRoster([
    { yahooId: "9001", name: "Pat Passer", team: "NYJ", position: "QB", slot: "QB" },
    { yahooId: "", name: "Same Name", team: "SEA", position: "WR", slot: "WR" },
    { yahooId: "2", name: "Linebacker", team: "BUF", position: "LB", slot: "BN" },
    { yahooId: "3", name: "Mystery", team: "BUF", position: "RB", slot: "ODD" },
  ], 0.75);
  const mapped = mapRoster(imported, directory);
  assert.equal(mapped.entries.length, 0);
  assert.equal(mapped.issues.length, 4);
  assert.equal(mapped.suggestedScoring, null);
});

test("Yahoo source stores labels and keys, no credentials", () => {
  const items = new Map<string, string>();
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };
  const source: YahooSource = { teamKey: "1.l.2.t.3", leagueName: "A League", teamName: "My Team", importedAt: "2026-09-23T00:00:00Z" };
  saveYahooSource(storage, source);
  assert.deepEqual(loadYahooSource(storage), source);
  assert.equal([...items.values()].join("").includes("token"), false);
  saveYahooSource(storage, null);
  assert.equal(loadYahooSource(storage), null);
});
