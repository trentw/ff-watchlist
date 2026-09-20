"""Write the ranking cases shared by the Python and browser test suites.

The Python core produces the expected output. The browser ranker must
reproduce it, and ``tests/test_parity_fixtures.py`` fails when this file's
output no longer matches what is committed.

    uv run python scripts/make_parity_fixtures.py
"""
from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from ff_watchlist.watch_core import Player, attach_projections, rank_payload

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "parity" / "rank_cases.json"


def _player(name: str, team: str, pos: str, slot: str | None = None) -> dict[str, Any]:
    return {"name": name, "team": team, "pos": pos, "slot": slot or pos}


def _row(name: str, team: str, pos: str, std: Any, half: Any = None, ppr: Any = None) -> dict[str, Any]:
    stats = {"points": std}
    if half is not None:
        stats["points_half"] = half
    if ppr is not None:
        stats["points_ppr"] = ppr
    return {"name": name, "team_id": team, "position_id": pos, "stats": stats}


def _game(away: str, home: str, kick_utc: str, network: str = "") -> dict[str, Any]:
    return {"away": away, "home": home, "kick_utc": kick_utc, "network": network}


SUNDAY = [
    _game("CIN", "TB", "2026-09-20T17:00Z", "CBS"),
    _game("MIN", "CHI", "2026-09-20T17:00Z", "FOX"),
    _game("GB", "DET", "2026-09-20T20:05Z", "FOX"),
    _game("KC", "DEN", "2026-09-20T20:25Z", "CBS"),
    _game("DAL", "PHI", "2026-09-21T00:20Z", "NBC"),
]

CASES: list[dict[str, Any]] = [
    {
        "name": "starters lead and bench points break ties",
        "scoring": "std",
        "players": [
            _player("Alpha Starter", "CIN", "WR"),
            _player("Small Bench", "MIN", "WR", "BN"),
            _player("Big Bench", "GB", "RB", "BN"),
            _player("Late Bench", "KC", "TE", "IR"),
        ],
        "projections": [
            _row("Alpha Starter", "CIN", "WR", 11.0),
            _row("Small Bench", "MIN", "WR", 7.0),
            _row("Big Bench", "GB", "RB", 9.0),
            _row("Late Bench", "KC", "TE", 9.0),
        ],
        "schedule": SUNDAY,
    },
    {
        "name": "1:05 and 1:25 kickoffs share a window",
        "scoring": "ppr",
        "players": [_player("Early Back", "GB", "RB"), _player("Late Passer", "KC", "QB")],
        "projections": [
            _row("Early Back", "GB", "RB", 9.0, 10.5, 12.0),
            _row("Late Passer", "KC", "QB", 21.4, 21.4, 21.4),
        ],
        "schedule": SUNDAY,
    },
    {
        "name": "missing, zero and negative points stay distinct",
        "scoring": "half",
        "players": [
            _player("No Projection", "CIN", "WR"),
            _player("Zero Points", "CIN", "RB"),
            _player("Bad Defense", "MIN", "DST", "DEF"),
            _player("Text Points", "CHI", "K"),
            _player("Infinite Points", "DET", "TE"),
            _player("Std Only", "DEN", "WR"),
        ],
        "projections": [
            _row("Zero Points", "CIN", "RB", 0, 0, 0),
            _row("Minnesota Vikings", "MIN", "DST", -2.0, -2.0, -2.0),
            _row("Text Points", "CHI", "K", "n/a", "n/a", "n/a"),
            _row("Infinite Points", "DET", "TE", "inf", "inf", "inf"),
            _row("Std Only", "DEN", "WR", 8.8),
        ],
        "schedule": SUNDAY,
    },
    {
        "name": "names normalize; team aliases and a unique traded player resolve",
        "scoring": "std",
        "players": [
            _player("Ja’Marr Chase", "CIN", "WR"),
            _player("Marvin Harrison Jr.", "DET", "WR"),
            _player("Jósé Núñez III", "TB", "K"),
            _player("Traded Runner", "PHI", "RB"),
            _player("Jaguars", "JAC", "DST", "DEF"),
        ],
        "projections": [
            _row("Ja'Marr Chase", "CIN", "WR", 14.2),
            _row("Marvin Harrison", "DET", "WR", 12.1),
            _row("Jose Nunez", "TB", "K", 7.7),
            _row("Traded Runner", "DAL", "RB", 10.0),
            _row("Jacksonville Jaguars", "JAX", "DST", 6.5),
        ],
        "schedule": SUNDAY + [_game("JAC", "WSH", "2026-09-20T17:00Z", "CBS")],
    },
    {
        "name": "a shared name on two other teams is never guessed",
        "scoring": "std",
        "players": [_player("Josh Allen", "KC", "QB")],
        "projections": [
            _row("Josh Allen", "BUF", "QB", 24.0),
            _row("Josh Allen", "JAX", "LB", 3.0),
        ],
        "schedule": SUNDAY,
    },
    {
        "name": "bye-week players are idle, not dropped",
        "scoring": "std",
        "players": [_player("On Bye", "SEA", "WR"), _player("Playing", "DAL", "QB")],
        "projections": [_row("On Bye", "SEA", "WR", 13.0), _row("Playing", "DAL", "QB", 19.5)],
        "schedule": SUNDAY,
    },
    {
        "name": "windows order across days and late-night UTC dates",
        "scoring": "std",
        "players": [
            _player("Thursday Kicker", "BUF", "K"),
            _player("London Receiver", "JAX", "WR"),
            _player("Sunday Night", "PHI", "RB"),
            _player("Monday Night", "LAC", "QB"),
        ],
        "projections": [
            _row("Thursday Kicker", "BUF", "K", 8.0),
            _row("London Receiver", "JAX", "WR", 12.5),
            _row("Sunday Night", "PHI", "RB", 16.0),
            _row("Monday Night", "LAC", "QB", 18.2),
        ],
        "schedule": [
            _game("LAC", "LV", "2026-09-22T02:15Z", "ESPN"),
            _game("DAL", "PHI", "2026-09-21T00:20Z", "NBC"),
            _game("JAX", "ATL", "2026-09-20T13:30Z", "NFLN"),
            _game("MIA", "BUF", "2026-09-18T00:15Z", "PRIME"),
        ],
    },
    {
        "name": "equal games keep schedule order",
        "scoring": "std",
        "players": [_player("Left", "CIN", "WR"), _player("Right", "CHI", "WR")],
        "projections": [_row("Left", "CIN", "WR", 10.0), _row("Right", "CHI", "WR", 10.0)],
        "schedule": SUNDAY,
    },
]


def _expected(case: dict[str, Any]) -> dict[str, Any]:
    players = [Player(**row) for row in case["players"]]
    attach_projections(players, case["projections"], case["scoring"])
    return rank_payload({"players": [asdict(p) for p in players], "schedule": case["schedule"]})


def build() -> str:
    cases = [{**case, "expected": _expected(case)} for case in CASES]
    return json.dumps({"timezone": "America/Los_Angeles", "cases": cases}, indent=1, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(build(), encoding="utf-8")
    print(f"wrote {FIXTURE.relative_to(FIXTURE.parents[2])}")
