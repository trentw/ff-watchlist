"""Deterministic watchlist core: the projection join and the game ranking."""
from __future__ import annotations

import datetime as dt
import math
import re
import unicodedata
from dataclasses import dataclass, field, asdict
from typing import Any
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")

SCORING_COL = {"std": "points", "half": "points_half", "ppr": "points_ppr"}
BENCH_SLOTS = {"BN", "BENCH", "IR", "IR+", "NA", "RES", "TAXI"}

# Every source spells a few franchises differently; canonical = ESPN-ish.
_TEAM_ALIAS = {"WSH": "WAS", "JAC": "JAX", "LA": "LAR", "OAK": "LV", "SD": "LAC", "STL": "LAR"}


def canon_team(t: str | None) -> str:
    t = (t or "").strip().upper()
    return _TEAM_ALIAS.get(t, t)


def norm_name(n: str) -> str:
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode()
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", n.lower())
    return re.sub(r"[^a-z]", "", n)


# ---------------------------------------------------------------- data model
@dataclass
class Player:
    name: str
    team: str
    pos: str
    slot: str  # lineup slot label, e.g. QB, W/R/T, DEF, BN, IR
    proj: float | None = None
    jersey: str | None = None

    @property
    def starter(self) -> bool:
        return self.slot.strip().upper() not in BENCH_SLOTS


@dataclass
class Game:
    away: str
    home: str
    kick: dt.datetime  # tz-aware, Pacific
    network: str = ""
    starters: list[Player] = field(default_factory=list)
    bench: list[Player] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"{self.away} @ {self.home}"

    @property
    def starter_pts(self) -> float:
        return sum(p.proj or 0.0 for p in self.starters)

    @property
    def bench_pts(self) -> float:
        return sum(p.proj or 0.0 for p in self.bench)

    def has(self, team: str) -> bool:
        return team in (self.away, self.home)


def slot_key(kick: dt.datetime) -> tuple[int, int]:
    """Kickoffs within the same hour on the same day share a slot, so Sun
    1:05 and 1:25 collapse into one 'Sun 1pm' bucket while 10:00 stays apart."""
    return (kick.date().toordinal(), kick.hour)


def slot_label(kick: dt.datetime) -> str:
    h = kick.hour % 12 or 12
    return f"{kick:%a} {h}{kick:%p}".replace("AM", "am").replace("PM", "pm")


# ------------------------------------------------------------------- joining
def attach_projections(players: list[Player], proj: list[dict[str, Any]], scoring: str) -> list[Player]:
    col = SCORING_COL[scoring]
    by_name: dict[tuple[str, str], float] = {}
    dst_by_team: dict[str, float] = {}
    for r in proj:
        raw = r.get("stats", {}).get(col)
        if raw is None:
            continue
        try:
            pts = float(raw)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(pts):
            continue
        team = canon_team(r.get("team_id"))
        if r["position_id"] == "DST":
            dst_by_team[team] = pts
        else:
            by_name[(norm_name(r["name"]), team)] = pts
    unmatched = []
    for p in players:
        team = canon_team(p.team)
        if p.pos == "DST":
            p.proj = dst_by_team.get(team)
        else:
            p.proj = by_name.get((norm_name(p.name), team))
            if p.proj is None:  # traded / team mismatch: fall back to name alone if unique
                hits = [v for (n, _t), v in by_name.items() if n == norm_name(p.name)]
                p.proj = hits[0] if len(hits) == 1 else None
        if p.proj is None:
            unmatched.append(p)
    return unmatched


def build_games(players: list[Player], sched: list[dict[str, Any]]) -> tuple[list[Game], list[Player]]:
    games = [Game(away=canon_team(g["away"]), home=canon_team(g["home"]), network=g["network"],
                  kick=dt.datetime.fromisoformat(g["kick_utc"].replace("Z", "+00:00")).astimezone(PACIFIC))
             for g in sched]
    idle: list[Player] = []
    for p in players:
        g = next((g for g in games if g.has(canon_team(p.team))), None)
        if g is None:
            idle.append(p)  # bye week, or a team ESPN hasn't scheduled
        elif p.starter:
            g.starters.append(p)
        else:
            g.bench.append(p)
    for g in games:
        g.starters.sort(key=lambda p: -(p.proj or 0))
        g.bench.sort(key=lambda p: -(p.proj or 0))
    return games, idle


def rank_slots(games: list[Game]) -> list[tuple[str, list[Game]]]:
    """Chronological slots; within a slot, starter points first, bench
    points as the tiebreak (a bench player beats an empty game), then kickoff."""
    slots: dict[tuple[int, int], list[Game]] = {}
    for g in sorted(games, key=lambda g: g.kick):
        slots.setdefault(slot_key(g.kick), []).append(g)
    out = []
    for key in sorted(slots):
        gs = sorted(slots[key], key=lambda g: (-g.starter_pts, -g.bench_pts, g.kick))
        out.append((slot_label(gs[0].kick), gs))
    return out


def rank_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """JSON-in/JSON-out adapter; calls the canonical ranker, never repeats math."""
    players = [Player(**{k: v for k, v in row.items() if k in Player.__dataclass_fields__})
               for row in payload["players"]]
    for player in players:
        player.team = canon_team(player.team)
        if player.proj is not None and not math.isfinite(float(player.proj)):
            raise ValueError("Projection points must be finite")
    games, idle = build_games(players, payload["schedule"])
    def game_row(game: Game) -> dict[str, Any]:
        row = asdict(game)
        row["kick"] = game.kick.isoformat()
        row.update(starter_pts=game.starter_pts, bench_pts=game.bench_pts)
        return row
    return {"slots": [{"label": label, "games": [game_row(g) for g in gs]}
                      for label, gs in rank_slots(games)],
            "idle": [asdict(p) for p in idle],
            "unmatched": [asdict(p) for p in players if p.proj is None]}
