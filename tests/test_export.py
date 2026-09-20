"""The static bundle is complete, validated and never half-replaced."""
import json

import pytest

from ff_watchlist.demo import DemoSources
from ff_watchlist.export import InvalidBundle, slim_directory, write_bundle


def _read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_demo_bundle_has_every_file_and_no_media(tmp_path):
    out = tmp_path / "data"
    manifest = write_bundle(DemoSources(), out, demo=True)
    assert manifest == _read(out / "manifest.json")
    assert (manifest["season"], manifest["week"], manifest["demo"]) == (2026, 2, True)
    assert manifest["media"] == {"headshots": False, "logos": False}
    for name in manifest["files"].values():
        assert _read(out / name)
    assert not list(tmp_path.glob(".bundle-*"))


def test_media_switches_are_recorded(tmp_path, monkeypatch):
    monkeypatch.setattr("ff_watchlist.export.MIN_PROJECTED_PLAYERS", 1)
    manifest = write_bundle(DemoSources(), tmp_path / "data", headshots=False)
    assert manifest["media"] == {"headshots": False, "logos": True}


def test_slim_directory_keeps_identity_for_fantasy_positions_only():
    slim = slim_directory({
        "1": {"full_name": "Pat Passer", "team": "JAC", "position": "QB", "number": 9, "active": True, "age": 27},
        "2": {"first_name": "Lee", "last_name": "Backer", "team": "CHI", "position": "LB"},
        "CHI": {"first_name": "Chicago", "last_name": "Bears", "team": "CHI", "position": "DEF"},
        "3": {"team": "DET", "position": "WR"},
        "4": "not a row",
    })
    assert slim == {
        "1": {"name": "Pat Passer", "team": "JAX", "position": "QB", "number": "9", "active": True},
        "CHI": {"name": "Chicago Bears", "team": "CHI", "position": "DST"},
    }


def test_invalid_data_leaves_the_previous_bundle_in_place(tmp_path):
    out = tmp_path / "data"
    write_bundle(DemoSources(), out, demo=True)
    before = (out / "manifest.json").read_text()

    class NoGames(DemoSources):
        def schedule(self, season, week):
            return []

    class BadPoints(DemoSources):
        def projections(self, season, week, scoring, source="sleeper"):
            result = super().projections(season, week, scoring)
            result["rows"][0]["stats"]["points_ppr"] = float("nan")
            return result

    for sources in (NoGames(), BadPoints()):
        with pytest.raises(InvalidBundle):
            write_bundle(sources, out, demo=True)
    assert (out / "manifest.json").read_text() == before
    assert not list(tmp_path.glob(".bundle-*"))


def test_real_bundles_need_broad_projection_coverage(tmp_path):
    with pytest.raises(InvalidBundle, match="only 4 players"):
        write_bundle(DemoSources(), tmp_path / "data", demo=False)
