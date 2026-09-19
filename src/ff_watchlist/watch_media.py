"""Optional public team and player media for the watch demo.

Media is deliberately separate from projections and ranking.  ESPN's public
NFL teams response supplies team names, colours and logo URLs; its public team
roster response supplies the player ``headshot.href`` URL.  We retain only
HTTPS image URLs from the ESPN CDN and cache each raw response in a dated
directory so a media outage never changes the watch result.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from .watch_core import canon_team, norm_name


_TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams"
_ROSTER_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team}/roster"
_IMAGE_HOSTS = {"a.espncdn.com"}
_TEAM_CODES = {
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN",
    "DET", "GB", "HOU", "IND", "JAX", "KC", "LV", "LAC", "LAR", "MIA",
    "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB",
    "TEN", "WAS",
}


def _today() -> str:
    return dt.date.today().isoformat()


def _safe_image(value: Any) -> str | None:
    """Accept only HTTPS image URLs from a known CDN host."""
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value.strip())
        if parsed.scheme != "https" or parsed.hostname not in _IMAGE_HOSTS:
            return None
    except ValueError:
        return None
    if not parsed.path.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        return None
    return value.strip()


def _team_code(value: Any) -> str:
    code = canon_team(str(value or ""))
    return code if code in _TEAM_CODES else ""


def _player_identity(name: Any, team: Any) -> str:
    return f"{norm_name(str(name or ""))}|{_team_code(team)}"


def _json_text(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n"


class PublicMedia:
    """Best-effort public media lookup with dated, provider-specific cache.

    ``directory`` may be the raw Sleeper player mapping (or a sequence of
    player mappings).  It is optional: callers can pass rows containing
    ``espn_id`` directly, while a directory lets the class resolve that ID by
    name/team.  ``http_get`` is injectable for deterministic tests.
    """

    source = "ESPN public teams/rosters"

    def __init__(self, cache_dir: Path | None = None, *, directory: Any = None,
                 refresh: bool = False, http_get: Callable[..., Any] | None = None):
        self.cache_dir = Path(cache_dir) if cache_dir is not None else Path("data/public-watch-media") / _today()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.directory = directory
        self.refresh = refresh
        self._http_get = http_get or httpx.get

    def _fetch(self, url: str) -> Any:
        response = self._http_get(url, timeout=30)
        response.raise_for_status()
        value = response.json()
        if not isinstance(value, (dict, list)):
            raise ValueError("provider response was not a JSON object or list")
        return value

    def _cached(self, path: Path, url: str) -> Any:
        if path.exists() and not self.refresh:
            return json.loads(path.read_text(encoding="utf-8"))
        value = self._fetch(url)
        # Write a complete response to a unique sibling before replacing the
        # cache. A failed fetch or concurrent reader never sees partial JSON.
        fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(_json_text(value))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
        return value

    def _directory_rows(self) -> list[dict[str, Any]]:
        raw = self.directory
        if isinstance(raw, Mapping):
            rows = list(raw.values())
        elif isinstance(raw, Sequence) and not isinstance(raw, (str, bytes, bytearray)):
            rows = list(raw)
        else:
            return []
        return [dict(row) for row in rows if isinstance(row, Mapping)]

    def _directory_index(self) -> dict[str, dict[str, Any]]:
        index: dict[str, dict[str, Any]] = {}
        for row in self._directory_rows():
            key = _player_identity(row.get("full_name") or row.get("name"), row.get("team"))
            if key != "|":
                index.setdefault(key, row)
        return index

    def _teams(self) -> dict[str, dict[str, Any]]:
        raw = self._cached(self.cache_dir / "espn-teams.json", _TEAMS_URL)
        rows = []
        if isinstance(raw, Mapping):
            sports = raw.get("sports")
            if isinstance(sports, list) and sports and isinstance(sports[0], Mapping):
                leagues = sports[0].get("leagues")
                if isinstance(leagues, list) and leagues and isinstance(leagues[0], Mapping):
                    rows = leagues[0].get("teams") or []
        teams: dict[str, dict[str, Any]] = {}
        for item in rows:
            team = item.get("team") if isinstance(item, Mapping) else None
            if not isinstance(team, Mapping):
                continue
            code = _team_code(team.get("abbreviation"))
            if not code:
                continue
            logo = None
            logos = team.get("logos")
            if isinstance(logos, list):
                for candidate in logos:
                    if not isinstance(candidate, Mapping):
                        continue
                    rel = candidate.get("rel") or []
                    if "default" in rel or "full" in rel:
                        logo = _safe_image(candidate.get("href"))
                        if logo:
                            break
            teams[code] = {
                "name": str(team.get("displayName") or team.get("name") or code),
                "logo": logo,
                "color": str(team.get("color") or "").lstrip("#") or None,
            }
        if not teams:
            raise ValueError("ESPN teams response had no usable teams")
        return teams

    @staticmethod
    def _roster_rows(raw: Any) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        if isinstance(raw, Mapping):
            athletes = raw.get("athletes") or []
            if isinstance(athletes, list):
                for group in athletes:
                    if isinstance(group, Mapping) and isinstance(group.get("items"), list):
                        rows.extend(x for x in group["items"] if isinstance(x, Mapping))
        return rows

    def _roster(self, team: str) -> list[dict[str, Any]]:
        return self._roster_rows(self._cached(
            self.cache_dir / f"espn-roster-{team.lower()}.json",
            _ROSTER_URL.format(team=team.lower()),
        ))

    def lookup(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        """Return media keyed by canonical team and ``norm_name|team``.

        Every provider/cache/shape failure becomes a warning.  An empty or
        partial result is valid and callers may render the watch board without
        any media at all.
        """
        result: dict[str, Any] = {"teams": {}, "players": {}, "source": self.source, "warnings": []}
        if not isinstance(players, list):
            result["warnings"].append("Media lookup skipped: players was not a list.")
            return result
        wanted: list[tuple[str, dict[str, Any]]] = []
        teams_needed: set[str] = set()
        directory = self._directory_index()
        for row in players:
            if not isinstance(row, Mapping):
                result["warnings"].append("Media lookup skipped one malformed player row.")
                continue
            name = row.get("name") or row.get("full_name")
            team = _team_code(row.get("team") or row.get("team_id"))
            key = _player_identity(name, team)
            if not name or not team or key.endswith("|"):
                continue
            wanted.append((key, dict(row)))
            teams_needed.add(team)
        if not wanted:
            return result
        try:
            all_teams = self._teams()
            # The one teams response contains all 32 clubs. Returning the
            # complete map lets the UI render opponents without extra calls;
            # roster photos below remain restricted to requested teams.
            result["teams"] = all_teams
            missing_teams = sorted(teams_needed - set(all_teams))
            if missing_teams:
                result["warnings"].append(f"No ESPN team metadata for: {', '.join(missing_teams)}.")
        except Exception as exc:
            result["warnings"].append(f"Team media unavailable: {type(exc).__name__}.")
            all_teams = {}

        # Roster data is fetched at most once per requested team and is cached
        # separately from the existing projection/schedule source cache.
        for team in sorted(teams_needed):
            try:
                roster = self._roster(team)
            except Exception as exc:
                result["warnings"].append(f"Player media unavailable for {team}: {type(exc).__name__}.")
                continue
            by_key: dict[str, list[dict[str, Any]]] = {}
            for athlete in roster:
                key = _player_identity(athlete.get("fullName") or athlete.get("displayName"), team)
                if key != "|":
                    by_key.setdefault(key, []).append(athlete)
            for key, row in wanted:
                if not key.endswith(f"|{team}"):
                    continue
                # Prefer an exact ESPN ID when supplied. Otherwise accept a
                # normalized name/team only when it identifies one roster
                # entry; silently choosing among duplicates is unsafe.
                directory_row = directory.get(key)
                espn_id = str(row.get("espn_id") or (directory_row or {}).get("espn_id") or "")
                matches = by_key.get(key, [])
                athlete = next((x for x in roster if str(x.get("id") or "") == espn_id), None) if espn_id else (matches[0] if len(matches) == 1 else None)
                if not athlete:
                    continue
                headshot = athlete.get("headshot")
                href = headshot.get("href") if isinstance(headshot, Mapping) else None
                image = _safe_image(href)
                if image:
                    result["players"][key] = {"headshot": image}
        return result
