"""Parse a pasted fantasy lineup against the public Sleeper player dump.

The paste path deliberately resolves only exact normalized names.  A name that
could refer to two players is kept out of the lineup and reported to the user;
guessing here is much worse than asking for a team abbreviation.
"""

from __future__ import annotations

import csv
import html
import re
from typing import Any

from . import watch_core as _watch_core

canon_team = _watch_core.canon_team
norm_name = _watch_core.norm_name
_shared_normalize_slot = getattr(_watch_core, "normalize_slot", None)
if _shared_normalize_slot is None:
    _shared_normalize_slot = getattr(_watch_core, "normalise_slot", None)


_BENCH = {"BN", "BENCH", "IR", "IR+", "NA", "RES", "RESERVE", "TAXI"}
_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DST", "DEF"}
_SLOTS = _POSITIONS | {"FLEX", "W/R", "W/R/T", "RB/WR", "RB/WR/TE", "STARTER"} | _BENCH

# canon_team handles abbreviations.  These aliases are for the common
# defense names people copy from a roster page (and for full team names in a
# generic player line).  All values are the canonical three-letter codes.
_TEAM_NAMES = {
    "ARIZONA": "ARI", "ARIZONA CARDINALS": "ARI", "CARDINALS": "ARI",
    "ATLANTA": "ATL", "ATLANTA FALCONS": "ATL", "FALCONS": "ATL",
    "BALTIMORE": "BAL", "BALTIMORE RAVENS": "BAL", "RAVENS": "BAL",
    "BUFFALO": "BUF", "BUFFALO BILLS": "BUF", "BILLS": "BUF",
    "CAROLINA": "CAR", "CAROLINA PANTHERS": "CAR", "PANTHERS": "CAR",
    "CHICAGO": "CHI", "CHICAGO BEARS": "CHI", "BEARS": "CHI",
    "CINCINNATI": "CIN", "CINCINNATI BENGALS": "CIN", "BENGALS": "CIN",
    "CLEVELAND": "CLE", "CLEVELAND BROWNS": "CLE", "BROWNS": "CLE",
    "DALLAS": "DAL", "DALLAS COWBOYS": "DAL", "COWBOYS": "DAL",
    "DENVER": "DEN", "DENVER BRONCOS": "DEN", "BRONCOS": "DEN",
    "DETROIT": "DET", "DETROIT LIONS": "DET", "LIONS": "DET",
    "GREEN BAY": "GB", "GREEN BAY PACKERS": "GB", "PACKERS": "GB",
    "HOUSTON": "HOU", "HOUSTON TEXANS": "HOU", "TEXANS": "HOU",
    "INDIANAPOLIS": "IND", "INDIANAPOLIS COLTS": "IND", "COLTS": "IND",
    "JACKSONVILLE": "JAX", "JACKSONVILLE JAGUARS": "JAX", "JAGUARS": "JAX",
    "KANSAS CITY": "KC", "KANSAS CITY CHIEFS": "KC", "CHIEFS": "KC",
    "LAS VEGAS": "LV", "LAS VEGAS RAIDERS": "LV", "RAIDERS": "LV",
    "LOS ANGELES": "LAR", "LOS ANGELES RAMS": "LAR", "RAMS": "LAR",
    "LOS ANGELES CHARGERS": "LAC", "CHARGERS": "LAC",
    "MIAMI": "MIA", "MIAMI DOLPHINS": "MIA", "DOLPHINS": "MIA",
    "MINNESOTA": "MIN", "MINNESOTA VIKINGS": "MIN", "VIKINGS": "MIN",
    "NEW ENGLAND": "NE", "NEW ENGLAND PATRIOTS": "NE", "PATRIOTS": "NE",
    "NEW ORLEANS": "NO", "NEW ORLEANS SAINTS": "NO", "SAINTS": "NO",
    "NEW YORK GIANTS": "NYG", "GIANTS": "NYG",
    "NEW YORK JETS": "NYJ", "JETS": "NYJ",
    "PHILADELPHIA": "PHI", "PHILADELPHIA EAGLES": "PHI", "EAGLES": "PHI",
    "PITTSBURGH": "PIT", "PITTSBURGH STEELERS": "PIT", "STEELERS": "PIT",
    "SAN FRANCISCO": "SF", "SAN FRANCISCO 49ERS": "SF", "49ERS": "SF",
    "SEATTLE": "SEA", "SEATTLE SEAHAWKS": "SEA", "SEAHAWKS": "SEA",
    "TAMPA BAY": "TB", "TAMPA BAY BUCCANEERS": "TB", "BUCCANEERS": "TB",
    "TENNESSEE": "TEN", "TENNESSEE TITANS": "TEN", "TITANS": "TEN",
    "WASHINGTON": "WAS", "WASHINGTON COMMANDERS": "WAS", "COMMANDERS": "WAS",
}
_TEAM_ALIASES = {**_TEAM_NAMES}
for _abbr in ("ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LV", "LAR", "LAC", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS"):
    _TEAM_ALIASES[_abbr] = _abbr
_TEAM_ALIASES.update({"WSH": "WAS", "JAC": "JAX", "LA": "LAR", "OAK": "LV", "SD": "LAC", "STL": "LAR"})
_KNOWN_TEAMS = set(_TEAM_ALIASES.values())


def _team_display(team: str) -> str:
    """Stable directory-style name for a defense alias with no player name."""
    names = [name for name, code in _TEAM_NAMES.items() if code == team and " " in name]
    return (sorted(names, key=len, reverse=True)[0].title() if names else team)


def _team(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    upper = re.sub(r"\s+", " ", raw.upper())
    result = _TEAM_ALIASES.get(upper, canon_team(upper))
    return result if result in _KNOWN_TEAMS else ""


def _slot(value: str | None) -> str:
    raw = re.sub(r"\s+", " ", (value or "").strip().upper())
    if _shared_normalize_slot is not None:
        try:
            normalized = _shared_normalize_slot(raw)
            if normalized:
                raw = str(normalized).upper()
        except (TypeError, ValueError):
            pass
    raw = raw.replace("D/ST", "DST").replace("DEFENSE", "DST").replace("DEF", "DST")
    raw = re.sub(r"\s*[/|]\s*", "/", raw)
    if raw in {"RES", "RESERVE"}:
        return "BN"
    return raw or "STARTER"


def _position(value: Any) -> str:
    p = str(value or "").strip().upper().replace("D/ST", "DST").replace("DEF", "DST")
    return p


def _visible(line: str) -> str:
    """Turn copied HTML-ish markup into visible text without rendering it."""
    line = re.sub(r"<\s*(script|style)\b[^>]*>.*?<\s*/\s*\1\s*>", " ", line, flags=re.I | re.S)
    line = re.sub(r"<!--.*?-->", " ", line, flags=re.S)
    line = re.sub(r"<\s*(?:br|/tr|/p|/li|/div)\s*/?\s*>", " ", line, flags=re.I)
    line = re.sub(r"<[^>]*>", " ", line)
    return re.sub(r"\s+", " ", html.unescape(line)).strip()


def _header(line: str) -> bool:
    key = re.sub(r"[^a-z]+", " ", line.lower()).strip()
    return key in {
        "name team slot", "player team slot", "player team pos", "name team position",
        "slot name team", "position player team", "position name team", "starters",
        "starting lineup", "player", "roster", "lineup",
    }


def _team_in(text: str) -> tuple[str, str] | None:
    """Return (canonical team, text with one team phrase removed)."""
    upper = text.upper()
    # Longer aliases first so LOS ANGELES CHARGERS wins over LOS ANGELES.
    for alias in sorted(_TEAM_ALIASES, key=len, reverse=True):
        m = re.search(r"(?<![A-Z0-9])" + re.escape(alias) + r"(?![A-Z0-9])", upper)
        if m:
            return _TEAM_ALIASES[alias], (text[:m.start()] + " " + text[m.end():]).strip()
    return None


def _parse_line(line: str) -> dict[str, Any] | None:
    """Parse one visible line, retaining only syntax and no player guess."""
    if not line:
        return None
    # CSV is the stable paste contract: name, team, slot.  Accept a leading
    # slot too because some platform exports use slot,name,team.
    if "," in line:
        try:
            fields = [f.strip() for f in next(csv.reader([line]))]
        except (csv.Error, StopIteration):
            fields = []
        if len(fields) >= 2:
            first_slot = _slot(fields[0])
            # A slot typo in the alternate ``slot,name,team`` layout should
            # remain a slot error, rather than being mistaken for a player's
            # name and silently losing the row.
            leading_typo = (
                len(fields) >= 3
                and first_slot not in _SLOTS
                and bool(_team(fields[2]))
                and bool(re.fullmatch(r"[A-Z][A-Z/+]{1,8}", fields[0]))
            )
            if first_slot in _SLOTS and len(fields) >= 3:
                raw_team = fields[2]
                slot, name, team = first_slot, fields[1], _team(raw_team)
                explicit = bool(team)
                invalid_team = raw_team if raw_team and not team else ""
                invalid_slot = ""
            elif leading_typo:
                raw_team = fields[2]
                name, team = fields[1], _team(raw_team)
                slot = _slot(fields[0])
                explicit = bool(team)
                invalid_team = raw_team if raw_team and not team else ""
                invalid_slot = fields[0]
            else:
                raw_team = fields[1]
                name, team = fields[0], _team(raw_team)
                raw_slot = fields[2] if len(fields) >= 3 else ""
                slot = _slot(raw_slot) if raw_slot else "STARTER"
                explicit = bool(team)
                invalid_team = raw_team if raw_team and not team else ""
                invalid_slot = raw_slot if raw_slot and slot not in _SLOTS else ""
            if len(fields) >= 4 and _slot(fields[-1]) in _SLOTS:
                slot = _slot(fields[-1])
            parsed = {"name": name, "team": team, "slot": slot, "explicit_team": explicit}
            if invalid_team:
                parsed["invalid_team"] = invalid_team
            if invalid_slot:
                parsed["invalid_slot"] = invalid_slot
            return parsed

    # Yahoo's copied roster row: QB  Caleb Williams  Chi - QB.
    m = re.match(r"^\s*(BN|BENCH|IR\+?|NA|RES|[A-Z][A-Z/+ -]*)\s+(.+?)\s+([A-Za-z .]+?)\s*-\s*([A-Za-z/+]+)\s*$", line, re.I)
    if m and _slot(m.group(1)) in _SLOTS:
        team = _team(m.group(3))
        if team:
            return {"name": m.group(2).strip(), "team": team, "slot": _slot(m.group(1)), "explicit_team": True,
                    "position": _position(m.group(4))}

    work = line.strip()
    slot = "STARTER"
    first = re.match(r"^(BN|BENCH|IR\+?|NA|RES|QB|RB|WR|TE|K|DEF|DST|FLEX|W/R(?:/T)?)\b\s+", work, re.I)
    if first:
        slot = _slot(first.group(1))
        work = work[first.end():].strip()

    # Pipe/tab and em-dash copies have unambiguous columns.
    parts = [p.strip() for p in re.split(r"\s*(?:\||\t|—|–)\s*", work) if p.strip()]
    if len(parts) >= 3 and _team(parts[-2]) and _position(parts[-1]) in _POSITIONS:
        return {"name": parts[0], "team": _team(parts[-2]),
                "slot": slot if slot != "STARTER" else _position(parts[-1]),
                "explicit_team": True, "position": _position(parts[-1])}
    if len(parts) >= 2 and _team(parts[-1]):
        team = _team(parts[-1])
        name = parts[0]
        position = _position(parts[1]) if len(parts) >= 3 else (parts[1] if parts[1].upper() in _POSITIONS else "")
        if position and position not in _POSITIONS:
            position = ""
        return {"name": name, "team": team, "slot": slot if slot != "STARTER" else (position or "STARTER"),
                "explicit_team": True, "position": position}

    # Remove a trailing ``- QB`` / ``(CHI) QB`` / bare position marker, then
    # extract a team alias.  This also handles "Caleb Williams Chi - QB".
    position = ""
    tail = re.search(r"(?:\s*-\s*|\s+|\()([A-Z][A-Z/+ ]{0,8})(?:\))?\s*$", work, re.I)
    if tail and _position(tail.group(1)) in _POSITIONS:
        position = _position(tail.group(1))
        work = work[:tail.start()].strip(" -(")
    team_hit = _team_in(work)
    if team_hit:
        team, remainder = team_hit
        name = re.sub(r"[(),]", " ", remainder).strip(" -")
        # A defense line is often just "Chicago Bears D/ST".
        if not name or _slot(slot) == "DST" or "D/ST" in line.upper() or "DEFENSE" in line.upper():
            name = remainder.strip(" -") or _team_display(team)
        return {"name": name, "team": team, "slot": slot if slot != "STARTER" else (position or "STARTER"),
                "explicit_team": True, "position": position}

    # A final position by itself is useful, but a bare name remains the most
    # permissive form and is resolved against the directory below.
    return {"name": work.strip(" ,"), "team": "", "slot": slot if slot != "STARTER" else (position or "STARTER"),
            "explicit_team": False, "position": position}


def _slot_only(line: str) -> str | None:
    """Return a slot marker when a platform pasted it on its own line."""
    value = line.strip().upper()
    if value in _SLOTS:
        return _slot(value)
    return None


def _team_position_line(line: str) -> tuple[str, str] | None:
    """Recognize the metadata line following a copied player name."""
    m = re.match(r"^\s*(.+?)\s*-\s*([A-Za-z/+]+)\s*$", line)
    if not m:
        return None
    team, pos = _team(m.group(1)), _position(m.group(2))
    if team and pos in _POSITIONS:
        return team, pos
    return None


def _active(row: dict[str, Any]) -> bool | None:
    if isinstance(row.get("active"), bool):
        return row["active"]
    status = str(row.get("status") or "").strip().lower()
    if status in {"active", "available"}:
        return True
    if status in {"inactive", "retired", "inactive_reserve"}:
        return False
    return None


def _directory_rows(directory: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for key, row in (directory.items() if isinstance(directory, dict) else []):
        if not isinstance(row, dict):
            continue
        name = row.get("full_name") or row.get("name") or row.get("player_name") or ""
        team = _team(row.get("team") or row.get("team_id"))
        pos = _position(row.get("position") or row.get("pos"))
        fps = row.get("fantasy_positions")
        if not pos and isinstance(fps, (list, tuple)) and fps:
            pos = _position(fps[0])
        if not name and pos in {"DST", "DEF"} and team:
            name = _team_display(team)
        rows.append({"id": str(key), "row": row, "name": str(name).strip(), "norm": norm_name(str(name)),
                     "team": team, "pos": pos, "active": _active(row)})
    return rows


def parse_lineup(text: str, directory: dict) -> dict[str, list]:
    """Parse pasted lineup text into resolved player dictionaries.

    ``directory`` is the raw object returned by Sleeper's players endpoint.
    Bench/reserve rows stay in ``players`` with their normalized bench slot;
    the ranker excludes them from starter scoring and may use them as its
    tiebreak.  Issues are line-addressable and never guess at an identity.
    """
    result: dict[str, list] = {"players": [], "issues": [], "warnings": []}
    if not isinstance(text, str):
        result["issues"].append({"line": 1, "text": "", "message": "lineup must be text"})
        return result
    rows = _directory_rows(directory)
    by_name: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row["norm"]:
            by_name.setdefault(row["norm"], []).append(row)
    seen: set[tuple[str, str]] = set()

    def issue(line_no: int, visible: str, message: str) -> None:
        result["issues"].append({"line": line_no, "text": visible, "message": message})

    # Yahoo and a few mobile views copy each field onto its own line.  Fold
    # only the unambiguous ``slot / name / team - position`` shape; every
    # other source line remains independent so malformed input is reported.
    visible_lines = [(n, _visible(raw)) for n, raw in enumerate(text.splitlines(), 1)]
    logical_lines: list[tuple[int, str]] = []
    i = 0
    while i < len(visible_lines):
        line_no, visible = visible_lines[i]
        marker = _slot_only(visible) if visible else None
        if marker is not None and i + 1 < len(visible_lines):
            next_no, next_visible = visible_lines[i + 1]
            if next_visible and not _header(next_visible) and _slot_only(next_visible) is None:
                combined = f"{marker} {next_visible}"
                consumed = 2
                if i + 2 < len(visible_lines):
                    meta_no, meta_visible = visible_lines[i + 2]
                    if meta_visible and _team_position_line(meta_visible):
                        combined = f"{combined} {meta_visible}"
                        consumed = 3
                logical_lines.append((line_no, combined))
                i += consumed
                continue
        logical_lines.append((line_no, visible))
        i += 1

    for line_no, visible in logical_lines:
        if not visible or _header(visible):
            continue
        parsed = _parse_line(visible)
        if not parsed or not parsed.get("name"):
            issue(line_no, visible, "could not parse a player line")
            continue
        if parsed.get("invalid_team"):
            issue(line_no, visible, f"unknown team {parsed['invalid_team']!r}; use an NFL abbreviation or team name")
            continue
        if parsed.get("invalid_slot"):
            issue(line_no, visible, f"unknown lineup slot {parsed['invalid_slot']!r}")
            continue
        slot = _slot(parsed.get("slot"))
        query_name = str(parsed["name"]).strip()
        query_norm = norm_name(query_name)
        hits = list(by_name.get(query_norm, []))
        requested_team = _team(parsed.get("team"))
        wanted_pos = _position(parsed.get("position")) or (_position(slot) if slot in _POSITIONS else "")
        active_hits = [h for h in hits if h["active"] is True]
        if requested_team:
            team_hits = [h for h in hits if h["team"] == requested_team]
            # If a current active row exists at a different team, do not make
            # an explicit old-team paste silently select the stale row.
            if active_hits and not any(h["team"] == requested_team for h in active_hits):
                issue(line_no, visible, f"team {requested_team} conflicts with the player's active/current team")
                continue
            hits = team_hits
            if not hits and query_norm and wanted_pos != "DST":
                issue(line_no, visible, f"team {requested_team} conflicts with the directory entry")
                continue
        elif active_hits:
            hits = active_hits

        if wanted_pos == "DST":
            hits = [h for h in hits if h["pos"] in {"DST", "DEF"}] or hits
        if wanted_pos and wanted_pos != "DST":
            pos_hits = [h for h in hits if h["pos"] == wanted_pos]
            if pos_hits:
                hits = pos_hits

        # Defense aliases are often a team name rather than the directory's
        # full_name.  Resolve by the explicitly identified team and DST pos.
        if not hits and wanted_pos == "DST" and requested_team:
            hits = [h for h in rows if h["team"] == requested_team and h["pos"] in {"DST", "DEF"}]
        if not hits:
            issue(line_no, visible, f"unmatched player name {query_name!r}; use the exact name or add a team")
            continue
        if len(hits) != 1:
            teams = ", ".join(sorted({h["team"] or "?" for h in hits}))
            issue(line_no, visible, f"ambiguous player name {query_name!r} ({teams}); add the current team")
            continue
        hit = hits[0]
        identity = (hit["id"], hit["team"])
        if identity in seen:
            issue(line_no, visible, f"duplicate player {hit['name'] or query_name!r}; row ignored")
            continue
        seen.add(identity)
        out = {"name": hit["name"] or query_name, "team": hit["team"] or requested_team,
               "pos": "DST" if hit["pos"] in {"DST", "DEF"} else (hit["pos"] or wanted_pos), "slot": slot}
        number = hit["row"].get("number")
        if number is None:
            number = hit["row"].get("jersey")
        if number not in (None, ""):
            out["jersey"] = str(number)
        result["players"].append(out)
    return result
