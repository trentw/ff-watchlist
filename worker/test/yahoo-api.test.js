import assert from "node:assert/strict";
import { test } from "node:test";
import { readGame, readLeagueName, readReception, readRoster, readTeams, YahooError } from "../yahoo-api.js";

test("extracts a season-specific game and the signed-in user's team", () => {
  const game = { fantasy_content: { games: { 0: { game: [[{ game_key: "461" }, { season: "2026" }]] }, count: 1 } } };
  assert.equal(readGame(game, 2026), "461");
  const teams = {
    fantasy_content: {
      users: {
        0: {
          user: [[], {
            games: {
              0: {
                game: [[], {
                  teams: {
                    0: { team: [[{ team_key: "461.l.12.t.3" }, { name: "My Team" }]] },
                    count: 1,
                  },
                }],
              },
              count: 1,
            },
          }],
        },
        count: 1,
      },
    },
  };
  assert.deepEqual(readTeams(teams, "461"), [{ key: "461.l.12.t.3", leagueKey: "461.l.12", name: "My Team" }]);
});

test("extracts roster slots and reception modifier from shaped responses", () => {
  const team = { fantasy_content: { team: [[{ team_key: "461.l.12.t.3" }], { roster: [[], { players: {
    0: { player: [[{ player_id: "9001" }, { name: { full: "Pat Passer" } }, { editorial_team_abbr: "Buf" }, { primary_position: "QB" },
      { selected_position: { week: "3", position: "QB" } }]] }, count: 1,
  } }] }] } };
  assert.deepEqual(readRoster(team, "461.l.12.t.3", 3), [{ yahooId: "9001", name: "Pat Passer", team: "Buf", position: "QB", slot: "QB" }]);
  const settings = { fantasy_content: { league: [[{ league_key: "461.l.12" }, { name: "A League" }], { settings: [{ stat_modifiers: { stats: {
    0: { stat: { stat_id: "11", value: "0.5" } }, count: 1,
  } } }] }] } };
  assert.equal(readLeagueName(settings, "461.l.12"), "A League");
  assert.equal(readReception(settings), 0.5);
});

test("reads Yahoo's numbered roster sub-resource and array selected position", () => {
  const team = { fantasy_content: { team: [[{ team_key: "461.l.12.t.3" }], { roster: {
    0: { players: { 0: { player: [
      [{ player_id: "9001" }, { name: { full: "Pat Passer" } }, { editorial_team_abbr: "BUF" }, { primary_position: "QB" }],
      { selected_position: [{ coverage_type: "week" }, { week: "3" }, { position: "QB" }] },
    ] }, count: 1 } }, coverage_type: "week", week: "3",
  } }] } };
  assert.deepEqual(readRoster(team, "461.l.12.t.3", 3), [{ yahooId: "9001", name: "Pat Passer", team: "BUF", position: "QB", slot: "QB" }]);
});

test("malformed provider data cannot become an empty successful import", () => {
  assert.throws(() => readRoster({ fantasy_content: {} }, "461.l.12.t.3", 3), YahooError);
  assert.throws(() => readGame({ fantasy_content: { games: {} } }, 2026), YahooError);
});
