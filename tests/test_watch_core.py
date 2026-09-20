"""The JSON ranking contract keeps bench, unknown and idle players distinct."""
import json
from ff_watchlist import watch_core as core


def test_json_contract_preserves_bench_unknown_and_idle():
    result = core.rank_payload({
        "players": [
            {"name": "Starter", "team": "CHI", "pos": "QB", "slot": "QB", "proj": 10},
            {"name": "Bench", "team": "MIN", "pos": "WR", "slot": "Bench", "proj": 40},
            {"name": "Missing", "team": "DET", "pos": "RB", "slot": "RB", "proj": None},
        ],
        "schedule": [
            {"away": "CHI", "home": "GB", "kick_utc": "2026-09-20T17:00Z", "network": "CBS"},
            {"away": "MIN", "home": "BUF", "kick_utc": "2026-09-20T17:00Z", "network": "FOX"},
        ],
    })
    assert json.loads(json.dumps(result)) == result
    games = result["slots"][0]["games"]
    assert [g["starter_pts"] for g in games] == [10, 0]
    assert games[1]["bench_pts"] == 40
    assert result["idle"][0]["name"] == "Missing"
    assert result["unmatched"][0]["proj"] is None


def test_selected_scoring_missing_does_not_become_standard_or_zero():
    player = core.Player("Test", "CHI", "QB", "QB")
    rows = [{"name": "Test", "team_id": "CHI", "position_id": "QB", "stats": {"points": 20}}]
    assert core.attach_projections([player], rows, "ppr") == [player]
    assert player.proj is None
