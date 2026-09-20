"""Credential-free data sources.

Sleeper supplies a player directory and weekly projections, while ESPN
supplies the NFL scoreboard.  Every response is cached below a dated
directory so a result can be replayed without network access.

The Sleeper projections endpoint is not a documented API.  The endpoint and
the response fields are kept in one adapter so a change there produces an
explicit ``SourceUnavailable`` rather than silently turning missing points
into zeros.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

import httpx

from .watch_core import canon_team


class SourceUnavailable(RuntimeError):
    """A requested public source could not provide a usable response."""


SCORINGS = {"std", "half", "ppr"}
_SLEEPER_PLAYERS = "https://api.sleeper.app/v1/players/nfl"
_SLEEPER_STATE = "https://api.sleeper.app/v1/state/nfl"
_ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"


def _utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _finite(value: Any) -> float | None:
    """Return a finite numeric value, retaining missing values as missing."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _team(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip().upper()
    return canon_team(value)


def _position(player: dict[str, Any]) -> str | None:
    pos = player.get("position") or player.get("position_id")
    if pos == "DEF" or pos == "D/ST":
        return "DST"
    if isinstance(pos, str) and pos:
        return pos.upper()
    positions = player.get("fantasy_positions")
    if isinstance(positions, list) and positions and isinstance(positions[0], str):
        return "DST" if positions[0] in {"DEF", "D/ST"} else positions[0].upper()
    return None


class PublicSources:
    """Read public watch inputs, with a dated cache and strict replay mode.

    ``cache_dir`` defaults to ``data/public-watch/YYYY-MM-DD``.  A supplied
    directory is used as-is, which keeps tests and offline replays isolated.
    ``replay=True`` never attempts a network request and raises
    :class:`SourceUnavailable` when a required cache file is absent.
    """

    def __init__(self, cache_dir: Path | None = None, replay: bool = False, refresh: bool = False):
        self.cache_dir = Path(cache_dir) if cache_dir is not None else Path("data/public-watch") / dt.date.today().isoformat()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.replay = replay
        self.refresh = refresh
        self.metadata: list[dict[str, Any]] = []
        self._metadata_path = self.cache_dir / "metadata.json"
        if self._metadata_path.exists():
            try:
                saved = json.loads(self._metadata_path.read_text())
                if isinstance(saved, list):
                    self.metadata = saved
            except (OSError, ValueError):
                # A corrupt optional sidecar must not make otherwise-valid raw
                # source caches unusable.
                self.metadata = []

    def _record(self, *, source: str, endpoint: str, status: str, fetched_at: str | None = None,
                error: str | None = None, replay: bool = False, cache_key: str | None = None) -> None:
        row: dict[str, Any] = {"source": source, "endpoint": endpoint, "status": status}
        if cache_key:
            row["cache_key"] = cache_key
        if fetched_at:
            row["fetched_at"] = fetched_at
        if error:
            row["error"] = error
        if replay:
            row["replay"] = True
        self.metadata.append(row)
        try:
            self._atomic_write(self._metadata_path, json.dumps(self.metadata, indent=2) + "\n")
        except OSError:
            # Provenance is useful but should not block a source response when
            # a read-only cache directory is supplied by a caller.
            pass

    @staticmethod
    def _atomic_write(path: Path, text: str) -> None:
        """Write a complete JSON/text cache object before replacing its path."""
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    def _cached_or_fetch(self, path: Path, *, source: str, endpoint: str,
                         fetch: Any, decode: Any) -> tuple[Any, str]:
        if path.exists() and (self.replay or not self.refresh):
            try:
                raw = path.read_text()
                return decode(raw), self._cached_fetched_at(path, source=source, endpoint=endpoint)
            except (OSError, ValueError, TypeError, KeyError) as exc:
                if self.replay:
                    self._record(source=source, endpoint=endpoint, status="error", error=f"invalid cache: {exc}", replay=True, cache_key=path.name)
                    raise SourceUnavailable(f"invalid replay cache {path}: {exc}") from exc
        if self.replay:
            self._record(source=source, endpoint=endpoint, status="missing", replay=True, cache_key=path.name)
            raise SourceUnavailable(f"replay cache missing: {path}")
        try:
            value, fetched_at = fetch()
            self._atomic_write(path, json.dumps(value, separators=(",", ":")) + "\n")
        except SourceUnavailable as exc:
            self._record(source=source, endpoint=endpoint, status="error", error=str(exc), cache_key=path.name)
            raise
        except (OSError, ValueError, TypeError, httpx.HTTPError) as exc:
            self._record(source=source, endpoint=endpoint, status="error", error=str(exc), cache_key=path.name)
            raise SourceUnavailable(f"{source} unavailable: {exc}") from exc
        self._record(source=source, endpoint=endpoint, status="ok", fetched_at=fetched_at, cache_key=path.name)
        return value, fetched_at

    def _cached_fetched_at(self, path: Path, *, source: str | None = None, endpoint: str | None = None) -> str:
        # Cache files are intentionally raw source objects.  Their mtime is a
        # fallback receipt when an older cache predates metadata.json.  Prefer
        # the actual upstream fetch timestamp when the sidecar has it.
        keyed = []
        legacy = []
        for row in self.metadata:
            if not isinstance(row, dict) or row.get("status") != "ok" or not row.get("fetched_at"):
                continue
            if source and row.get("source") != source:
                continue
            if endpoint and row.get("endpoint") != endpoint:
                continue
            if row.get("cache_key") == path.name:
                keyed.append(row)
            elif not row.get("cache_key"):
                legacy.append(row)
        if keyed:
            return str(keyed[-1]["fetched_at"])
        # Metadata written before cache_key was introduced is safe only when
        # exactly one matching receipt exists; otherwise use this file's mtime
        # rather than report another week's timestamp.
        if len(legacy) == 1:
            return str(legacy[0]["fetched_at"])
        try:
            return dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        except OSError:
            return ""

    @staticmethod
    def _get_json(url: str, *, params: Any = None, timeout: float = 60) -> Any:
        try:
            response = httpx.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SourceUnavailable(f"{url}: {exc}") from exc

    def current_week(self) -> tuple[int, int]:
        """Return Sleeper's current regular-season ``(season, week)``."""
        path = self.cache_dir / "sleeper-state.json"

        def fetch() -> tuple[dict[str, Any], str]:
            value = self._get_json(_SLEEPER_STATE)
            if not isinstance(value, dict):
                raise SourceUnavailable("Sleeper state was not an object")
            return value, _utc_now()

        state, _ = self._cached_or_fetch(path, source="sleeper-state", endpoint=_SLEEPER_STATE,
                                          fetch=fetch, decode=json.loads)
        if not isinstance(state, dict) or state.get("season_type") != "regular":
            raise SourceUnavailable("Sleeper does not report a regular-season week")
        try:
            season, week = int(state["season"]), int(state.get("display_week") or state["week"])
        except (KeyError, TypeError, ValueError) as exc:
            raise SourceUnavailable("Sleeper state had no usable season and week") from exc
        if not 1 <= week <= 18:
            raise SourceUnavailable(f"Sleeper reported week {week}, outside the regular season")
        return season, week

    def players(self) -> dict[str, Any]:
        """Return Sleeper's raw NFL player directory, preserving its shape."""
        path = self.cache_dir / "sleeper-players.json"

        def fetch() -> tuple[dict[str, Any], str]:
            value = self._get_json(_SLEEPER_PLAYERS, timeout=90)
            if not isinstance(value, dict):
                raise SourceUnavailable("Sleeper player directory was not an object")
            return value, _utc_now()

        value, _ = self._cached_or_fetch(path, source="sleeper-players", endpoint=_SLEEPER_PLAYERS,
                                          fetch=fetch, decode=json.loads)
        if not isinstance(value, dict):
            raise SourceUnavailable("Sleeper player cache was not an object")
        return value

    def schedule(self, season: int, week: int) -> list[dict[str, Any]]:
        """Return ESPN scoreboard rows in the shape consumed by ``build_games``."""
        path = self.cache_dir / f"espn-scoreboard-{season}-week{week}.json"
        endpoint = _ESPN_SCOREBOARD

        def fetch() -> tuple[list[dict[str, Any]], str]:
            data = self._get_json(endpoint, params={"dates": str(season), "seasontype": "2", "week": str(week)})
            events = data.get("events") if isinstance(data, dict) else None
            if not isinstance(events, list):
                raise SourceUnavailable("ESPN scoreboard did not contain events")
            rows = self._schedule_rows(events)
            return rows, _utc_now()

        value, _ = self._cached_or_fetch(path, source="espn-scoreboard", endpoint=endpoint,
                                          fetch=fetch, decode=json.loads)
        if not isinstance(value, list):
            raise SourceUnavailable("ESPN scoreboard cache was not a list")
        return value

    @staticmethod
    def _schedule_rows(events: list[Any]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for event in events:
            if not isinstance(event, dict) or not event.get("date"):
                continue
            competitions = event.get("competitions")
            if not isinstance(competitions, list) or not competitions or not isinstance(competitions[0], dict):
                continue
            home = away = None
            for competitor in competitions[0].get("competitors", []):
                if not isinstance(competitor, dict):
                    continue
                team = competitor.get("team") or {}
                abbr = _team(team.get("abbreviation")) if isinstance(team, dict) else None
                if competitor.get("homeAway") == "home":
                    home = abbr
                elif competitor.get("homeAway") == "away":
                    away = abbr
            if not (home and away):
                continue
            broadcasts = competitions[0].get("broadcasts") or []
            networks = [name for broadcast in broadcasts if isinstance(broadcast, dict) for name in (broadcast.get("names") or []) if isinstance(name, str)]
            status = ((event.get("status") or {}).get("type") or {}).get("name", "")
            rows.append({"away": away, "home": home, "kick_utc": event["date"],
                         "network": ", ".join(networks), "status": status})
        if not rows and events:
            raise SourceUnavailable("ESPN scoreboard events had no usable matchups")
        return rows

    def projections(self, season: int, week: int, scoring: str, source: str = "sleeper") -> dict[str, Any]:
        """Return normalized legacy projection rows for one week.

        Sleeper publishes all three preset totals in one response.  ESPN's
        player endpoint has no stable, documented scoring contract here, so it
        is an explicit capability stub until a preset-scoring fixture can be
        proven; callers receive ``SourceUnavailable`` rather than guessed
        points.
        """
        scoring = scoring.lower()
        if scoring not in SCORINGS:
            raise ValueError(f"unsupported scoring {scoring!r}; expected std, half, or ppr")
        if source.lower() != "sleeper":
            raise SourceUnavailable("ESPN weekly projections are not enabled: preset scoring mapping is not yet demonstrated")
        path = self.cache_dir / f"sleeper-projections-{season}-week{week}.json"
        endpoint = f"https://api.sleeper.app/projections/nfl/{season}/{week}"

        def fetch() -> tuple[list[Any], str]:
            params: list[tuple[str, str]] = [("season_type", "regular")]
            params.extend(("position[]", pos) for pos in ("QB", "RB", "WR", "TE", "K", "DEF"))
            value = self._get_json(endpoint, params=params)
            if isinstance(value, dict):
                value = value.get("players") or value.get("data")
            if not isinstance(value, list):
                raise SourceUnavailable("Sleeper projections were not a list")
            return value, _utc_now()

        raw, fetched_at = self._cached_or_fetch(path, source="sleeper-projections", endpoint=endpoint,
                                                 fetch=fetch, decode=json.loads)
        if not isinstance(raw, list):
            raise SourceUnavailable("Sleeper projection cache was not a list")
        directory = self.players()
        rows: list[dict[str, Any]] = []
        diagnostics: Counter[str] = Counter()
        diagnostic_details: list[str] = []
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                diagnostics["malformed_rows"] += 1
                diagnostic_details.append(f"row {index}: not an object")
                continue
            player_id = str(item.get("player_id") or "")
            player = directory.get(player_id) if player_id else None
            nested = item.get("player") if isinstance(item.get("player"), dict) else {}
            if not isinstance(player, dict):
                # The projections response currently repeats enough identity
                # fields to remain useful even when a player-directory row is
                # retired between the two requests.
                player = {}
                diagnostics["missing_directory_rows"] += 1
            if not player_id:
                diagnostics["missing_player_id"] += 1
            name = (player.get("full_name") or
                    " ".join(str(x) for x in (player.get("first_name"), player.get("last_name")) if x) or
                    nested.get("full_name") or
                    " ".join(str(x) for x in (nested.get("first_name"), nested.get("last_name")) if x) or
                    item.get("full_name") or item.get("name"))
            team = _team(player.get("team") or item.get("team") or nested.get("team"))
            position = (_position(player) or _position(nested) or
                        str(item.get("position_id") or "").upper() or None)
            if not (isinstance(name, str) and name and team and position):
                # Sleeper includes free agents and historical/inactive rows in
                # the same projection response.  They have a perfectly good
                # name and position but no team, so they cannot join a matchup;
                # keep that complete diagnostic out of user-facing warnings.
                if isinstance(name, str) and name and position and not team:
                    diagnostics["unassigned_rows"] += 1
                    diagnostic_details.append(f"row {index}: player_id={player_id or '<no id>'} name={name!r} position={position} has no team")
                else:
                    diagnostics["missing_identity_rows"] += 1
                    diagnostic_details.append(
                        f"row {index}: player_id={player_id or '<no id>'} "
                        f"name={bool(name)} team={team or '<missing>'} position={position or '<missing>'}"
                    )
                continue
            source_stats = item.get("stats") if isinstance(item.get("stats"), dict) else item
            stats: dict[str, float] = {}
            for output, keys in {
                "points": ("pts_std", "points"),
                "points_half": ("pts_half_ppr", "points_half"),
                "points_ppr": ("pts_ppr", "points_ppr"),
            }.items():
                number = next((_finite(source_stats.get(key)) for key in keys if key in source_stats), None)
                if number is not None:
                    stats[output] = number
            rows.append({"name": name, "team_id": team, "position_id": position, "stats": stats})
        # Unassigned rows are expected in the provider's global pool and are
        # retained in diagnostics, not presented as an alarming page warning.
        warning_labels = {"malformed_rows", "missing_player_id", "missing_identity_rows"}
        warnings = [f"{count} projection rows {label.replace('_', ' ')}"
                    for label, count in sorted(diagnostics.items()) if label in warning_labels]
        return {
            "rows": rows,
            "source": "sleeper",
            "provider": "RotoWire" if any(isinstance(item, dict) and str(item.get("company", "")).lower() == "rotowire" for item in raw) else None,
            "attribution": "Sleeper projection endpoint; rows identify RotoWire as the company" if any(isinstance(item, dict) and str(item.get("company", "")).lower() == "rotowire" for item in raw) else "Sleeper",
            "fetched_at": fetched_at,
            "warnings": warnings,
            "diagnostics": {"counts": dict(diagnostics), "details": diagnostic_details},
        }
