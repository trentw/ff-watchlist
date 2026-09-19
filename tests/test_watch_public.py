"""HTTP contract tests for the credential-free public watch demo."""

from __future__ import annotations

from fastapi.testclient import TestClient

from ff_watchlist import watch_public
from ff_watchlist.watch_sources import SourceUnavailable


class FakeSources:
    def __init__(self, *, fail: bool = False):
        self.fail = fail

    def players(self):
        return {"1": {"full_name": "Starter", "team": "CIN"}}

    def projections(self, season, week, scoring, source="sleeper"):
        if self.fail:
            raise SourceUnavailable("projection service unavailable")
        return {
            "rows": [
                {"name": "Starter", "team_id": "CIN", "position_id": "WR",
                 "stats": {"points": 12.0, "points_half": 13.0, "points_ppr": 14.0}},
                {"name": "Bench", "team_id": "MIN", "position_id": "RB",
                 "stats": {"points": 7.0, "points_half": 8.0, "points_ppr": 9.0}},
            ],
            "source": "sleeper",
            "fetched_at": "2026-09-18T20:00:00Z",
            "warnings": [],
        }

    def schedule(self, season, week):
        return [
            {"away": "CIN", "home": "TB", "kick_utc": "2026-09-20T17:00:00Z",
             "network": "CBS", "status": "STATUS_SCHEDULED"},
            {"away": "MIN", "home": "CHI", "kick_utc": "2026-09-20T17:25:00Z",
             "network": "FOX", "status": "STATUS_SCHEDULED"},
        ]


def _parsed_lineup(text, directory):
    return {
        "players": [
            {"name": "Starter", "team": "CIN", "pos": "WR", "slot": "WR"},
            {"name": "Bench", "team": "MIN", "pos": "RB", "slot": "BN"},
        ],
        "issues": [],
        "warnings": [],
    }


def test_watch_ranks_starter_and_preserves_bench_tiebreak(monkeypatch):
    monkeypatch.setattr(watch_public, "parse_lineup", _parsed_lineup)
    client = TestClient(watch_public.create_app(FakeSources()))

    response = client.post("/api/watch", json={
        "lineup": "WR Starter CIN\nBN Bench MIN",
        "season": 2026,
        "week": 2,
        "scoring": "half",
        "source": "sleeper",
    })

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "sleeper"
    assert body["fetched_at"].endswith("Z")
    assert body["scoring"] == "half"
    assert body["slots"] == body["ranked"]["slots"]
    first_slot = body["slots"][0]
    assert first_slot["games"][0]["away"] == "CIN"
    assert first_slot["games"][0]["starter_pts"] == 13.0
    assert first_slot["games"][1]["bench_pts"] == 8.0
    assert first_slot["games"][0]["starters"][0]["name"] == "Starter"
    assert first_slot["games"][1]["bench"][0]["name"] == "Bench"


def test_watch_returns_parser_issues_but_uses_matches(monkeypatch):
    def parsed(text, directory):
        return {
            "players": [{"name": "Starter", "team": "CIN", "pos": "WR", "slot": "WR"}],
            "issues": [{"line": 2, "text": "WR ??", "message": "name was not recognized"}],
            "warnings": ["One lineup line was skipped."],
        }

    monkeypatch.setattr(watch_public, "parse_lineup", parsed)
    body = TestClient(watch_public.create_app(FakeSources())).post(
        "/api/watch", json={"lineup": "WR Starter CIN\nWR ??"}
    )

    assert body.status_code == 200
    assert body.json()["issues"][0]["message"] == "name was not recognized"
    assert "skipped" in body.json()["warnings"][0]
    assert body.json()["players"][0]["name"] == "Starter"


def test_watch_all_unmatched_is_actionable_422(monkeypatch):
    monkeypatch.setattr(watch_public, "parse_lineup", lambda text, directory: {
        "players": [],
        "issues": [{"line": 1, "text": "Unknown", "message": "not recognized"}],
        "warnings": [],
    })
    response = TestClient(watch_public.create_app(FakeSources())).post(
        "/api/watch", json={"lineup": "Unknown"}
    )

    assert response.status_code == 422
    assert "No players matched" in response.json()["detail"]["message"]
    assert response.json()["issues"]


def test_watch_source_failure_is_503_without_internal_details(monkeypatch):
    monkeypatch.setattr(watch_public, "parse_lineup", _parsed_lineup)
    response = TestClient(watch_public.create_app(FakeSources(fail=True))).post(
        "/api/watch", json={"lineup": "Starter"}
    )

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["source"] == "sleeper"
    assert "fallback" in detail
    assert "/Users/" not in response.text


def test_pasted_projections_work_without_provider(monkeypatch):
    monkeypatch.setattr(watch_public, "parse_lineup", _parsed_lineup)
    source = FakeSources(fail=True)
    response = TestClient(watch_public.create_app(source)).post(
        "/api/watch",
        json={
            "lineup": "Starter",
            "projections": "name,team,points\nStarter,CIN,11\nBench,MIN,4\n",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "paste"
    assert body["slots"][0]["games"][0]["starter_pts"] == 11.0
    assert any("pasted" in warning for warning in body["warnings"])


def test_pasted_projections_reject_nonfinite_and_duplicate_identity(monkeypatch):
    monkeypatch.setattr(watch_public, "parse_lineup", _parsed_lineup)
    client = TestClient(watch_public.create_app(FakeSources(fail=True)))

    nonfinite = client.post("/api/watch", json={
        "lineup": "Starter",
        "projections": "name,team,points\nStarter,CIN,NaN\n",
    })
    assert nonfinite.status_code == 422
    assert "non-finite" in nonfinite.json()["detail"]["message"]

    duplicate = client.post("/api/watch", json={
        "lineup": "Starter",
        "projections": "name,team,points\nStarter,CIN,10\nStarter,CIN,11\n",
    })
    assert duplicate.status_code == 422
    assert "duplicates" in duplicate.json()["detail"]["message"]


def test_config_does_not_require_credentials():
    client = TestClient(watch_public.create_app(FakeSources()))
    page = client.get("/")
    assert page.status_code == 200
    assert "Matchups to watch" in page.text
    response = client.get("/api/config")
    assert response.status_code == 200
    body = response.json()
    assert body["default_season"] == 2026
    assert body["capabilities"]["projections"]["available"] == ["sleeper"]
    assert "espn" in body["capabilities"]["projections"]["stubs"]


def test_optional_media_endpoint_keeps_name_team_identity():
    class Media:
        def lookup(self, players):
            return {"teams": {"CHI": {"name": "Chicago Bears", "logo": None}},
                    "players": {"calebwilliams|CHI": {"headshot": "https://a.espncdn.com/test.png"}},
                    "warnings": [], "source": "ESPN"}
    client = TestClient(watch_public.create_app(media=Media()))
    response = client.post('/api/media', json={"players": [{"name": "Caleb Williams", "team": "CHI"}]})
    assert response.status_code == 200
    assert response.json()['players'][0]['name'] == 'Caleb Williams'
    assert response.json()['players'][0]['headshot'] == 'https://a.espncdn.com/test.png'


def test_optional_media_failure_does_not_fail_request():
    class BrokenMedia:
        def lookup(self, players):
            raise RuntimeError('private filesystem path')
    client = TestClient(watch_public.create_app(media=BrokenMedia()))
    response = client.post('/api/media', json={"players": []})
    assert response.status_code == 200
    assert response.json()['players'] == []
    assert 'private filesystem' not in response.text
