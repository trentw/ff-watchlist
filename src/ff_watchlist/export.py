"""Write the static data bundle the browser app reads.

A bundle is one week of shared facts: a slim player directory, the schedule
and projection rows, plus a manifest naming each source and when it was
fetched. It is staged and validated as a whole, so a bad provider response
never replaces a good bundle.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import shutil
import tempfile
from pathlib import Path
from typing import Any

from .watch_core import SCORING_COL, canon_team

SCHEMA_VERSION = 1
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DST"}
MIN_PROJECTED_PLAYERS = 100


class InvalidBundle(ValueError):
    """The collected data is not fit to publish."""


def slim_directory(directory: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Keep the identity fields lineup matching needs, for fantasy positions."""
    slim: dict[str, dict[str, Any]] = {}
    for player_id, row in directory.items():
        if not isinstance(row, dict):
            continue
        position = str(row.get("position") or (row.get("fantasy_positions") or [""])[0] or "").upper()
        position = "DST" if position in {"DEF", "D/ST"} else position
        if position not in FANTASY_POSITIONS:
            continue
        name = row.get("full_name") or " ".join(str(x) for x in (row.get("first_name"), row.get("last_name")) if x)
        if not name:
            continue
        entry: dict[str, Any] = {"name": name, "team": canon_team(row.get("team")), "position": position}
        if row.get("number") not in (None, ""):
            entry["number"] = str(row["number"])
        if isinstance(row.get("active"), bool):
            entry["active"] = row["active"]
        slim[str(player_id)] = entry
    return slim


def _validate(players: dict[str, Any], schedule: list[Any], rows: list[Any], *, demo: bool) -> None:
    if not players:
        raise InvalidBundle("player directory is empty")
    if not schedule:
        raise InvalidBundle("schedule has no games")
    for game in schedule:
        if not (game.get("away") and game.get("home")):
            raise InvalidBundle("schedule row is missing a team")
        try:
            dt.datetime.fromisoformat(str(game.get("kick_utc")).replace("Z", "+00:00"))
        except ValueError as exc:
            raise InvalidBundle(f"schedule row has an unreadable kickoff: {game.get('kick_utc')!r}") from exc
    for column in SCORING_COL.values():
        projected = 0
        for row in rows:
            value = row.get("stats", {}).get(column)
            if value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise InvalidBundle(f"projection for {row.get('name')!r} has a non-numeric {column}")
            projected += 1
        if projected < (1 if demo else MIN_PROJECTED_PLAYERS):
            raise InvalidBundle(f"only {projected} players have {column} projections")


def _credit(projections: dict[str, Any]) -> str:
    """Short credit line shown beside every projected number."""
    if projections.get("source") == "sleeper":
        provider = projections.get("provider")
        return f"Projections: Sleeper / {provider}" if provider else "Projections: Sleeper"
    return str(projections.get("attribution") or projections.get("source") or "Projections")


def _write(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")


def write_bundle(sources: Any, out_dir: Path, *, season: int | None = None, week: int | None = None,
                 demo: bool = False, headshots: bool = True, logos: bool = True) -> dict[str, Any]:
    """Collect one week from ``sources`` and replace ``out_dir`` with it."""
    if season is None or week is None:
        season, week = sources.current_week()
    players = slim_directory(sources.players())
    schedule = sources.schedule(season, week)
    projections = sources.projections(season, week, "std")
    rows = projections["rows"]
    _validate(players, schedule, rows, demo=demo)

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    manifest = {
        "schema": SCHEMA_VERSION,
        "generated_at": now,
        "season": season,
        "week": week,
        "demo": demo,
        "projections": {
            "source": projections.get("source"),
            "attribution": _credit(projections),
            "fetched_at": projections.get("fetched_at"),
        },
        "media": {"headshots": headshots and not demo, "logos": logos and not demo},
        "files": {"players": "players.json", "schedule": "schedule.json", "projections": "projections.json"},
    }

    out_dir = Path(out_dir)
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    staged = Path(tempfile.mkdtemp(prefix=".bundle-", dir=out_dir.parent))
    try:
        _write(staged / "players.json", players)
        _write(staged / "schedule.json", schedule)
        _write(staged / "projections.json", rows)
        _write(staged / "manifest.json", manifest)
        staged.chmod(0o755)
        if out_dir.exists():
            shutil.rmtree(out_dir)
        staged.rename(out_dir)
    finally:
        shutil.rmtree(staged, ignore_errors=True)
    return manifest
