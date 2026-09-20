import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseLineup, teamDisplayName } from "../src/lineup.ts";
import type { Directory, ParsedLineup } from "../src/lineup.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../../tests/parity/lineup_cases.json", import.meta.url), "utf8"),
) as { directory: Directory; cases: { name: string; text: string; expected: ParsedLineup }[] };

for (const parityCase of fixture.cases) {
  test(`matches the Python parser: ${parityCase.name}`, () => {
    const actual = parseLineup(parityCase.text, fixture.directory);
    assert.deepEqual(actual.players, parityCase.expected.players);
    assert.deepEqual(actual.issues, parityCase.expected.issues);
  });
}

test("team display names are title case", () => {
  assert.equal(teamDisplayName("SF"), "San Francisco 49Ers");
  assert.equal(teamDisplayName("LAC"), "Los Angeles Chargers");
  assert.equal(teamDisplayName("XXX"), "XXX");
});

test("messages quote names the way the Python parser does", () => {
  const { issues } = parseLineup("Nobody O'Real", fixture.directory);
  assert.equal(issues[0]!.message, `unmatched player name "Nobody O'Real"; use the exact name or add a team`);
});
