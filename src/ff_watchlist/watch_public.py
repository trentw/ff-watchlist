"""Small public API for the lineup based watch demo.

This module deliberately knows nothing about the private personal watch
command.  The public app only accepts a lineup supplied by the visitor and
uses the public source and pure ranking contracts.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import math
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .watch_core import Player, attach_projections, canon_team, norm_name, rank_payload
from .watch_lineup import parse_lineup
from .watch_sources import PublicSources, SourceUnavailable
from .watch_media import PublicMedia


STATIC_DIR = Path(__file__).parent / "watch_public_static"
DEFAULT_SEASON = 2026
DEFAULT_WEEK = 2
SCORINGS = ("std", "half", "ppr")


class MediaPlayer(BaseModel):
    name: str
    team: str


class MediaRequest(BaseModel):
    players: list[MediaPlayer]


class WatchRequest(BaseModel):
    """JSON accepted by ``POST /api/watch``.

    ``projections`` is intentionally just a pasteable CSV.  It gives a user
    with a paid projection subscription a working path when a public feed is
    temporarily down, without storing their roster or credentials.
    """

    lineup: str = Field(min_length=1)
    season: int = Field(default=DEFAULT_SEASON, ge=2020, le=2100)
    week: int = Field(default=DEFAULT_WEEK, ge=1, le=18)
    scoring: Literal["std", "half", "ppr"] = "std"
    source: Literal["sleeper", "espn"] = "sleeper"
    projections: str | None = None


def _json_value(value: Any) -> Any:
    """Turn core dataclasses into values FastAPI can encode."""

    if is_dataclass(value):
        return {k: _json_value(v) for k, v in asdict(value).items()}
    if isinstance(value, dict):
        return {str(k): _json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(v) for v in value]
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    return value


def _as_player(row: dict[str, Any]) -> Player:
    """Create a core Player while tolerating parser-added optional fields."""

    allowed = {"name", "team", "pos", "slot", "jersey", "proj", "yahoo_id"}
    values = {k: row[k] for k in allowed if k in row}
    values.setdefault("slot", "START")
    # The parser contract uses ``pos``.  Keeping this guard makes a malformed
    # custom parser result a useful 422 rather than a server traceback.
    for key in ("name", "team", "pos"):
        if not values.get(key):
            raise ValueError(f"lineup player is missing {key}")
    return Player(**values)


def _player_mapping(player: Any) -> dict[str, Any]:
    if isinstance(player, dict):
        return dict(_json_value(player))
    if is_dataclass(player):
        return dict(_json_value(player))
    return dict(_json_value(vars(player)))


def _projection_rows(text: str, players: list[Player]) -> list[dict[str, Any]]:
    """Parse the deliberately tiny ``name,team,points`` fallback format."""

    try:
        reader = csv.DictReader(io.StringIO(text.strip()))
        fields = {str(f).strip().lower() for f in (reader.fieldnames or [])}
        required = {"name", "team", "points"}
        if not required <= fields:
            raise ValueError("CSV must have name,team,points columns")
        rows: list[dict[str, Any]] = []
        by_identity = {
            (norm_name(str(p.name)), canon_team(str(p.team))): p
            for p in players
        }
        seen: set[tuple[str, str]] = set()
        for index, raw in enumerate(reader, 2):
            # DictReader preserves the input headers, so resolve them without
            # requiring a particular capitalization.
            normalized = {str(k).strip().lower(): (v or "").strip() for k, v in raw.items() if k}
            name, team, points = normalized.get("name", ""), normalized.get("team", ""), normalized.get("points", "")
            if not (name and team and points):
                raise ValueError(f"CSV row {index} needs name, team, and points")
            try:
                number = float(points)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"CSV row {index} has a non-numeric points value") from exc
            if not math.isfinite(number):
                raise ValueError(f"CSV row {index} has a non-finite points value")
            identity = (norm_name(name), canon_team(team))
            if identity in seen:
                raise ValueError(f"CSV row {index} duplicates {name} ({team})")
            seen.add(identity)
            p = by_identity.get(identity)
            # The core joins by normalized name/team and only needs a position
            # to distinguish DST rows.  Unknown rows remain harmless.
            pos = getattr(p, "pos", "WR") if p else "WR"
            rows.append({
                "name": name,
                "team_id": team.upper(),
                "position_id": pos,
                "stats": {"points": number, "points_half": number, "points_ppr": number},
            })
        if not rows:
            raise ValueError("CSV contains no projection rows")
        return rows
    except csv.Error as exc:
        raise ValueError("could not read projections CSV") from exc


def _source_fetched_at(result: Any) -> str | None:
    if isinstance(result, dict):
        value = result.get("fetched_at")
        return str(value) if value else None
    return None


def _source_rows(result: Any) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        raise ValueError("projection source returned an invalid response")
    rows = result.get("rows")
    if not isinstance(rows, list):
        raise ValueError("projection source returned no projection rows")
    return rows


def _error_detail(message: str, *, source: str | None = None,
                  fallback: str = "Paste a CSV with name,team,points columns and try again.") -> dict[str, Any]:
    detail: dict[str, Any] = {"message": message}
    if source:
        detail["source"] = source
    detail["fallback"] = fallback
    return detail


def _source_error(source: str | None = None) -> dict[str, Any]:
    """Return a stable public error without replay paths or provider URLs."""

    fallback = "Try again later."
    if source in {"sleeper", "espn"}:
        fallback = "Try again later, or paste a CSV with name,team,points columns."
    return _error_detail("Public data source is temporarily unavailable.", source=source, fallback=fallback)


def _capabilities() -> dict[str, Any]:
    return {
        "lineup": {"paste": True, "platforms": ["any"]},
        "projections": {
            "default": "sleeper",
            "available": ["sleeper"],
            "stubs": ["espn", "nflverse", "yahoo", "sleeper-connect"],
            "paste_csv": "name,team,points",
        },
        "scoring": list(SCORINGS),
        "schedule": {"source": "public"},
    }


def create_app(sources: PublicSources | None = None, media: PublicMedia | None = None) -> FastAPI:
    """Build the public watch API.

    ``sources`` is injectable so tests and offline deployments can provide a
    replay source.  No credentials, user roster, or request body is persisted.
    """

    source_client = sources if sources is not None else PublicSources()
    app = FastAPI(title="FF Watchlist", version="1")

    @app.get("/")
    def index() -> Any:
        page = STATIC_DIR / "index.html"
        if not page.exists():
            raise HTTPException(status_code=404, detail="public watch page is not installed")
        return FileResponse(page)

    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=STATIC_DIR), name="watch-static")

    @app.get("/api/config")
    def config() -> dict[str, Any]:
        return {
            "default_season": DEFAULT_SEASON,
            "default_week": DEFAULT_WEEK,
            "capabilities": _capabilities(),
        }

    @app.get("/api/capabilities")
    def capabilities() -> dict[str, Any]:
        return _capabilities()

    @app.post("/api/media")
    def player_media(body: MediaRequest) -> dict[str, Any]:
        # A separate optional call: photos must never hold up the watch result.
        players = [player.model_dump() for player in body.players]
        try:
            result = (media if media is not None else PublicMedia()).lookup(players)
        except Exception:
            return {"teams": {}, "players": [], "warnings": ["Images are unavailable."]}
        photos = []
        for player in players:
            name, team = str(player.get("name") or ""), canon_team(player.get("team"))
            entry = result.get("players", {}).get(f"{norm_name(name)}|{team}")
            if entry:
                photos.append({"name": name, "team": team, "headshot": entry.get("headshot")})
        return {**result, "players": photos}

    @app.post("/api/watch")
    def watch(req: WatchRequest) -> JSONResponse:
        # A synchronous FastAPI route runs in its worker pool.  PublicSources
        # uses synchronous httpx calls, so this keeps provider I/O off the
        # event loop without duplicating its source contract.
        try:
            directory = source_client.players()
            parsed = parse_lineup(req.lineup, directory)
        except SourceUnavailable:
            return JSONResponse(status_code=503, content={"detail": _source_error("players")})
        except Exception:
            # Parser errors are input errors.  Keep internals and filesystem
            # paths out of the public response.
            return JSONResponse(status_code=422, content={"detail": _error_detail(
                "Could not parse lineup; check each pasted row.",
                fallback="Check player names and team abbreviations, then try again.",
            )})

        parsed = parsed if isinstance(parsed, dict) else {}
        raw_players = parsed.get("players") or []
        issues = parsed.get("issues") or []
        warnings = [str(w) for w in (parsed.get("warnings") or [])]
        if not raw_players:
            return JSONResponse(status_code=422, content={
                "detail": _error_detail(
                    "No players matched the lineup. Check each name/team and try again.",
                    fallback="Use an exact player name with a team abbreviation, then try again.",
                ),
                "issues": _json_value(issues),
                "warnings": warnings,
            })

        try:
            players = [_as_player(row) for row in raw_players]
        except (TypeError, ValueError) as exc:
            return JSONResponse(status_code=422, content={"detail": _error_detail(f"invalid lineup player: {exc}")})

        fetched_at: str | None = None
        source_name = "paste"
        attribution = "User-provided projections"
        try:
            if req.projections is not None:
                rows = _projection_rows(req.projections, players)
                warnings.append("Using projections pasted with this request.")
            else:
                result = source_client.projections(req.season, req.week, req.scoring, source=req.source)
                rows = _source_rows(result)
                source_name = str(result.get("source") or req.source)
                attribution = str(result.get("attribution") or source_name)
                fetched_at = _source_fetched_at(result)
                warnings.extend(str(w) for w in (result.get("warnings") or []))
        except SourceUnavailable:
            return JSONResponse(status_code=503, content={"detail": _source_error(req.source)})
        except (ValueError, TypeError) as exc:
            return JSONResponse(status_code=422, content={"detail": _error_detail(str(exc), source=source_name)})
        except Exception:
            # A provider's implementation must not turn a transient upstream
            # or programming detail into a path/credential leak.
            return JSONResponse(status_code=503, content={
                "detail": _error_detail("Projection source is temporarily unavailable.", source=req.source),
            })

        try:
            unmatched = attach_projections(players, rows, req.scoring)
            # rank_payload is the JSON-shaped boundary of the pure core.  We
            # intentionally pass the post-join mappings so it owns game
            # construction and ranking in exactly the same way as the UI.
            ranked = rank_payload({
                "players": [_player_mapping(p) for p in players],
                "schedule": source_client.schedule(req.season, req.week),
            })
        except SourceUnavailable:
            return JSONResponse(status_code=503, content={"detail": _source_error("schedule")})
        except Exception:
            return JSONResponse(status_code=503, content={
                "detail": _error_detail(
                    "The schedule or ranking source is temporarily unavailable.",
                    fallback="Try again later.",
                ),
            })

        ranked = _json_value(ranked)
        # Core rank_payload owns the canonical unmatched/idle representation;
        # retain projection joins here as well for clients that want to render
        # the lineup editor before traversing the game cards.
        unmatched_json = _json_value(unmatched)
        if isinstance(ranked, dict) and not ranked.get("unmatched") and unmatched_json:
            ranked["unmatched"] = unmatched_json
        result = {
            "ranked": ranked,
            **(ranked if isinstance(ranked, dict) else {}),
            "players": [_player_mapping(p) for p in players],
            "issues": _json_value(issues),
            "warnings": warnings,
            "source": source_name,
            "attribution": attribution,
            "fetched_at": fetched_at,
            "season": req.season,
            "week": req.week,
            "scoring": req.scoring,
        }
        return JSONResponse(content=_json_value(result))

    return app


app = create_app()


__all__ = ["app", "create_app"]
