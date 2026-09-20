import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { attachProjections, normName, rank, windowLabel } from "../src/core.ts";
import type { Player, ProjectionRow, ScheduledGame, Scoring } from "../src/core.ts";

interface ExpectedGame {
  away: string;
  home: string;
  kick: string;
  network: string;
  starters: Player[];
  bench: Player[];
  starter_pts: number;
  bench_pts: number;
}

interface ParityCase {
  name: string;
  scoring: Scoring;
  players: Player[];
  projections: ProjectionRow[];
  schedule: ScheduledGame[];
  expected: { slots: { label: string; games: ExpectedGame[] }[]; idle: Player[]; unmatched: Player[] };
}

const fixture = JSON.parse(
  readFileSync(new URL("../../tests/parity/rank_cases.json", import.meta.url), "utf8"),
) as { timezone: string; cases: ParityCase[] };

const summary = (players: Player[]) => players.map((p) => [p.name, p.slot, p.proj ?? null]);

for (const parityCase of fixture.cases) {
  test(`matches the Python core: ${parityCase.name}`, () => {
    const players = structuredClone(parityCase.players);
    attachProjections(players, parityCase.projections, parityCase.scoring);
    const actual = rank(players, parityCase.schedule, fixture.timezone);
    const { expected } = parityCase;

    assert.deepEqual(actual.windows.map((w) => w.label), expected.slots.map((s) => s.label));
    actual.windows.forEach((window, index) => {
      const games = expected.slots[index]!.games;
      assert.deepEqual(
        window.games.map((g) => [g.away, g.home, g.network, Date.parse(g.kick), g.starter_pts, g.bench_pts]),
        games.map((g) => [g.away, g.home, g.network, Date.parse(g.kick), g.starter_pts, g.bench_pts]),
      );
      assert.deepEqual(window.games.map((g) => summary(g.starters)), games.map((g) => summary(g.starters)));
      assert.deepEqual(window.games.map((g) => summary(g.bench)), games.map((g) => summary(g.bench)));
    });
    assert.deepEqual(summary(actual.idle), summary(expected.idle));
    assert.deepEqual(summary(actual.unmatched), summary(expected.unmatched));
  });
}

test("a window is the same set of games in every timezone", () => {
  const schedule: ScheduledGame[] = [
    { away: "GB", home: "DET", kick_utc: "2026-09-20T20:05Z", network: "FOX" },
    { away: "KC", home: "DEN", kick_utc: "2026-09-20T20:25Z", network: "CBS" },
    { away: "DAL", home: "PHI", kick_utc: "2026-09-21T00:20Z", network: "NBC" },
  ];
  const pacific = rank([], schedule, "America/Los_Angeles");
  const sydney = rank([], schedule, "Australia/Sydney");
  assert.deepEqual(pacific.windows.map((w) => w.id), ["2026-09-20T20:00:00.000Z", "2026-09-21T00:00:00.000Z"]);
  assert.deepEqual(sydney.windows.map((w) => w.id), pacific.windows.map((w) => w.id));
  assert.deepEqual(sydney.windows.map((w) => w.games.length), [2, 1]);
  assert.deepEqual(sydney.windows.map((w) => w.label), ["Mon 6am", "Mon 10am"]);
});

test("labels follow the requested timezone", () => {
  assert.equal(windowLabel("2026-09-20T17:00Z", "America/New_York"), "Sun 1pm");
  assert.equal(windowLabel("2026-09-20T17:00Z", "America/Los_Angeles"), "Sun 10am");
});

test("names ignore accents, punctuation and generational suffixes", () => {
  assert.equal(normName("Jósé Núñez III"), "josenunez");
  assert.equal(normName("Ja’Marr Chase"), normName("Ja'Marr Chase"));
  assert.equal(normName("Marvin Harrison Jr."), "marvinharrison");
});

test("non-finite points are rejected rather than ranked", () => {
  const player: Player = { name: "A", team: "CIN", pos: "WR", slot: "WR", proj: Number.POSITIVE_INFINITY };
  assert.throws(() => rank([player], []), RangeError);
});
