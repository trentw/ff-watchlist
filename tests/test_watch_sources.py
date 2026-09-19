"""Public watch source adapters: cache, replay, joins and failure semantics."""

import json
from pathlib import Path

import httpx
import pytest

from ff_watchlist.watch_sources import PublicSources, SourceUnavailable


class _Response:
    def __init__(self, value):
        self.value = value

    def raise_for_status(self):
        return None

    def json(self):
        return self.value


def test_sleeper_players_and_projection_join_are_cached(monkeypatch, tmp_path: Path):
    calls = []
    players = {
        "100": {"full_name": "A Player", "team": "CIN", "position": "WR", "number": "9"},
        "200": {"full_name": "D/ST", "team": "JAX", "position": "DEF"},
    }
    projections = [
        {"player_id": "100", "stats": {"pts_std": 10, "pts_half_ppr": 12.5, "pts_ppr": float("nan")}},
        {"player_id": "200", "stats": {"pts_std": None, "pts_half_ppr": 5.0},
         "player": {"first_name": "Jacksonville", "last_name": "Jaguars", "team": "JAX", "position": "DEF"}},
    ]

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        if url.endswith("/players/nfl"):
            return _Response(players)
        return _Response(projections)

    monkeypatch.setattr("ff_watchlist.watch_sources.httpx.get", fake_get)
    sources = PublicSources(tmp_path)
    result = sources.projections(2026, 2, "half")
    assert result["source"] == "sleeper"
    assert result["rows"] == [
        {"name": "A Player", "team_id": "CIN", "position_id": "WR", "stats": {"points": 10.0, "points_half": 12.5}},
        {"name": "D/ST", "team_id": "JAX", "position_id": "DST", "stats": {"points_half": 5.0}},
    ]
    assert len(calls) == 2
    assert result["diagnostics"]["counts"] == {}
    assert (tmp_path / "sleeper-players.json").exists()
    assert (tmp_path / "sleeper-projections-2026-week2.json").exists()
    assert sources.players() == players

    def fail_get(*args, **kwargs):
        raise AssertionError("cache read unexpectedly made a network request")

    monkeypatch.setattr("ff_watchlist.watch_sources.httpx.get", fail_get)
    assert PublicSources(tmp_path, replay=True).projections(2026, 2, "ppr")["rows"][0]["stats"]["points"] == 10.0


def test_schedule_normalizes_espn_shape(monkeypatch, tmp_path: Path):
    payload = {"events": [{"date": "2026-09-20T17:00Z", "status": {"type": {"name": "STATUS_SCHEDULED"}},
                            "competitions": [{"competitors": [{"homeAway": "home", "team": {"abbreviation": "JAC"}},
                                                                  {"homeAway": "away", "team": {"abbreviation": "WSH"}}],
                                               "broadcasts": [{"names": ["CBS", "NFL"]}]}]}]}
    monkeypatch.setattr("ff_watchlist.watch_sources.httpx.get", lambda *a, **k: _Response(payload))
    rows = PublicSources(tmp_path).schedule(2026, 2)
    assert rows == [{"away": "WAS", "home": "JAX", "kick_utc": "2026-09-20T17:00Z",
                     "network": "CBS, NFL", "status": "STATUS_SCHEDULED"}]


def test_replay_is_strict_and_missing_cache_is_explicit(tmp_path: Path, monkeypatch):
    def fail_get(*args, **kwargs):
        raise AssertionError("replay attempted network")

    monkeypatch.setattr("ff_watchlist.watch_sources.httpx.get", fail_get)
    with pytest.raises(SourceUnavailable, match="replay cache missing"):
        PublicSources(tmp_path, replay=True).schedule(2026, 2)


def test_espn_projection_is_explicit_stub(tmp_path: Path):
    with pytest.raises(SourceUnavailable, match="preset scoring mapping"):
        PublicSources(tmp_path).projections(2026, 2, "std", source="espn")


def test_http_failure_becomes_source_unavailable(monkeypatch, tmp_path: Path):
    def fail_get(*args, **kwargs):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr("ff_watchlist.watch_sources.httpx.get", fail_get)
    with pytest.raises(SourceUnavailable, match="offline"):
        PublicSources(tmp_path).players()


def test_cache_key_keeps_same_endpoint_week_receipts_separate(tmp_path: Path):
    (tmp_path / "espn-scoreboard-2026-week1.json").write_text("[]")
    (tmp_path / "espn-scoreboard-2026-week2.json").write_text("[]")
    endpoint = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
    (tmp_path / "metadata.json").write_text(json.dumps([
        {"source": "espn-scoreboard", "endpoint": endpoint, "status": "ok",
         "cache_key": "espn-scoreboard-2026-week1.json", "fetched_at": "2026-09-18T01:00:00Z"},
        {"source": "espn-scoreboard", "endpoint": endpoint, "status": "ok",
         "cache_key": "espn-scoreboard-2026-week2.json", "fetched_at": "2026-09-18T02:00:00Z"},
    ]))
    sources = PublicSources(tmp_path, replay=True)
    assert sources._cached_fetched_at(tmp_path / "espn-scoreboard-2026-week1.json", source="espn-scoreboard", endpoint=endpoint) == "2026-09-18T01:00:00Z"
    assert sources._cached_fetched_at(tmp_path / "espn-scoreboard-2026-week2.json", source="espn-scoreboard", endpoint=endpoint) == "2026-09-18T02:00:00Z"


def test_projection_identity_falls_back_to_nested_row_and_summarizes_diagnostics(tmp_path: Path):
    sources = PublicSources(tmp_path)
    (tmp_path / "sleeper-players.json").write_text(json.dumps({}))
    (tmp_path / "sleeper-projections-2026-week2.json").write_text(json.dumps([
        {"player_id": "x", "player": {"first_name": "A", "last_name": "Player", "team": "CIN", "position": "WR"},
         "stats": {"pts_std": 4.0}, "company": "rotowire"},
        {"player_id": "bad", "stats": {"pts_std": 4.0}},
    ]))
    result = sources.projections(2026, 2, "std")
    assert result["rows"][0]["name"] == "A Player"
    assert result["provider"] == "RotoWire"
    assert result["warnings"] == ["1 projection rows missing identity rows"]
    assert result["diagnostics"]["counts"] == {"missing_identity_rows": 1, "missing_directory_rows": 2}
    assert result["diagnostics"]["details"]
