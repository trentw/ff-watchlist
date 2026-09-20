import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeShare, emptyRoster, encodeShare, loadRoster, resolveRoster, saveRoster } from "../src/roster.ts";
import type { Roster } from "../src/roster.ts";
import { buildIndex, searchPlayers } from "../src/search.ts";
import type { Directory } from "../src/lineup.ts";

const directory: Directory = {
  "1": { name: "Justin Jefferson", team: "MIN", position: "WR", number: "18", active: true },
  "2": { name: "Justin Fields", team: "NYJ", position: "QB", active: true },
  "3": { name: "Van Jefferson", team: "TEN", position: "WR", active: true },
  "4": { name: "Retired Justin", team: "MIN", position: "WR", active: false },
  "5": { name: "Free Justin", team: "", position: "K", active: true },
  "6": { name: "Amon-Ra St. Brown", team: "DET", position: "WR", active: true },
  MIN: { name: "Minnesota Vikings", team: "MIN", position: "DST", active: true },
};
const roster: Roster = { version: 1, scoring: "ppr", entries: [{ id: "1", slot: "WR" }, { id: "MIN", slot: "BN" }, { id: "6", slot: "W/R/T" }] };

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    size: () => items.size,
  };
}

test("a roster survives a save and a share link", () => {
  const storage = memoryStorage();
  assert.equal(saveRoster(storage, roster), true);
  assert.deepEqual(loadRoster(storage), roster);
  assert.deepEqual(decodeShare(`#${encodeShare(roster)}`), roster);
});

test("an empty roster clears storage, and missing storage is not an error", () => {
  const storage = memoryStorage();
  saveRoster(storage, roster);
  saveRoster(storage, emptyRoster());
  assert.equal(storage.size(), 0);
  assert.equal(saveRoster(undefined, roster), false);
  assert.equal(loadRoster(undefined), null);
  assert.equal(loadRoster({ getItem: () => { throw new Error("blocked"); } }), null);
});

test("damaged or hostile input is rejected or trimmed", () => {
  assert.equal(decodeShare("#"), null);
  assert.equal(decodeShare("#s=ppr&p=nodot"), null);
  assert.equal(decodeShare("#s=bogus&p=1.WR"), null);
  assert.equal(loadRoster({ getItem: () => "{not json" }), null);
  assert.equal(loadRoster({ getItem: () => JSON.stringify({ version: 2, scoring: "ppr", entries: [] }) }), null);
  const many = Array.from({ length: 80 }, (_, i) => `${i}.WR`).join(",");
  assert.equal(decodeShare(`#s=std&p=${many},1.WR`)!.entries.length, 40);
  assert.equal(decodeShare("#s=std&p=1.WR,1.BN")!.entries.length, 1);
});

test("saved ids resolve against the current directory", () => {
  const { players, missing } = resolveRoster({ ...roster, entries: [...roster.entries, { id: "gone", slot: "RB" }] }, directory);
  assert.deepEqual(players[0], { id: "1", name: "Justin Jefferson", team: "MIN", pos: "WR", slot: "WR", jersey: "18" });
  assert.deepEqual(players.map((p) => p.slot), ["WR", "BN", "W/R/T"]);
  assert.deepEqual(missing, [{ id: "gone", slot: "RB" }]);
});

test("search matches word prefixes and skips inactive and unsigned players", () => {
  const index = buildIndex(directory);
  const names = (query: string) => searchPlayers(index, query).map((r) => r.entry.name);
  assert.deepEqual(names("justin"), ["Justin Fields", "Justin Jefferson"]);
  assert.deepEqual(names("jef"), ["Justin Jefferson", "Van Jefferson"]);
  assert.deepEqual(names("justin j"), ["Justin Jefferson"]);
  assert.deepEqual(names("st brown"), ["Amon-Ra St. Brown"]);
  assert.deepEqual(names("vikings"), ["Minnesota Vikings"]);
  assert.deepEqual(names("  "), []);
});
