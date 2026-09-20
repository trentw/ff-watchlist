"""Credential-free watch ranking and rendering shared by personal and public apps."""
from __future__ import annotations

import datetime as dt
import html
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
    slot: str  # Yahoo slot label: QB/RB/WR/TE/W/R/K/DEF/BN/IR
    yahoo_id: str | None = None
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


def attach_jerseys(players: list[Player], jerseys: dict[tuple[str, str], str]) -> None:
    for p in players:
        if p.pos != "DST":
            p.jersey = jerseys.get((norm_name(p.name), p.team))


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


# ------------------------------------------------------------------ rendering
def _fmt_pts(x: float | None) -> str:
    return "—" if x is None else f"{x:.1f}"


def _player_line(p: Player, muted: bool) -> str:
    num = f"#{p.jersey}" if p.jersey else ("DST" if p.pos == "DST" else "#?")
    cls = "bench" if muted else "starter"
    tag = f'<span class="tag">{html.escape(p.slot)}</span>'
    return (f'<li class="{cls}"><span class="num">{num}</span> '
            f'<span class="name">{html.escape(p.name)}</span> '
            f'<span class="meta">{p.pos} · {p.team}</span> {tag} '
            f'<span class="pts">{_fmt_pts(p.proj)}</span></li>')


def _game_card(g: Game, rank: int) -> str:
    n_st, n_bn = len(g.starters), len(g.bench)
    empty = not (n_st or n_bn)
    klass = "game empty" if empty else ("game" if n_st else "game benchonly")
    kick = g.kick.strftime("%-I:%M %p").lower()
    head = (f'<div class="head"><span class="rank">{rank}</span>'
            f'<span class="matchup">{g.label}</span>'
            f'<span class="kick">{kick} PT{(" · " + html.escape(g.network)) if g.network else ""}</span>'
            f'<span class="score">{_fmt_pts(g.starter_pts)} <small>pts · {n_st} starter{"s" if n_st != 1 else ""}'
            f'{f" · {n_bn} bench" if n_bn else ""}</small></span></div>')
    body = ""
    if n_st:
        body += "<ul>" + "".join(_player_line(p, False) for p in g.starters) + "</ul>"
    if n_bn:
        body += (f'<div class="benchhdr">Bench — not scoring for us (tiebreak only, {_fmt_pts(g.bench_pts)} pts)</div>'
                 "<ul>" + "".join(_player_line(p, True) for p in g.bench) + "</ul>")
    if empty:
        body = '<div class="none">none of our players</div>'
    return f'<div class="{klass}">{head}{body}</div>'


CSS = """
:root{--fg:#1b1b1b;--muted:#6b6b6b;--bg:#fafaf7;--card:#fff;--line:#e3e1da;--top:#0b6b3a;--tag:#eef0ea}
body{font:15px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:20px 16px 40px;max-width:900px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);font-size:13px;margin-bottom:18px}
h2{font-size:17px;margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid var(--line)}
.game{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:8px 0}
.game:first-of-type{border-color:var(--top);box-shadow:0 0 0 2px rgba(11,107,58,.12)}
.game.empty{opacity:.55;padding:6px 12px}.game.benchonly{opacity:.85}
.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.rank{font-weight:700;color:var(--top);min-width:1.2em}.matchup{font-weight:700;font-size:16px}
.kick{color:var(--muted);font-size:13px}.score{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums}
.score small{font-weight:400;color:var(--muted)}
ul{list-style:none;margin:6px 0 0;padding:0}li{display:flex;gap:8px;align-items:baseline;padding:2px 0}
.num{font-weight:700;min-width:3em;font-variant-numeric:tabular-nums}.name{font-weight:600}
.meta{color:var(--muted);font-size:13px}.tag{background:var(--tag);border-radius:4px;padding:0 5px;font-size:11px;color:var(--muted)}
.pts{margin-left:auto;font-variant-numeric:tabular-nums}
li.bench{color:var(--muted)}li.bench .name{font-weight:500;text-decoration:none}
.benchhdr{margin-top:8px;font-size:12px;color:var(--muted);font-style:italic}
.none{color:var(--muted);font-size:13px}.warn{background:#fff4e0;border:1px solid #f0c98a;border-radius:6px;padding:8px 12px;margin:10px 0;font-size:13px}
.summary{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.summary td{padding:2px 10px 2px 0}
"""


def render_html(*, league_label: str, week: int, scoring: str, slots: list[tuple[str, list[Game]]],
                idle: list[Player], unmatched: list[Player], generated: dt.datetime, source_label: str = "Projections") -> str:
    parts = [f"<!doctype html><meta charset=utf-8><title>Watch — Week {week} — {html.escape(league_label)}</title>",
             f"<style>{CSS}</style>",
             f"<h1>Which game to watch — Week {week}</h1>",
             f'<div class="sub">{html.escape(league_label)} · {html.escape(source_label)} weekly projections ({scoring}) · '
             f'lineup as of {generated:%a %b %-d, %-I:%M %p} PT · re-run <code>ff-watchlist</code> after lineup changes</div>']
    # at-a-glance table: one line per slot
    parts.append('<table class="summary">')
    for label, gs in slots:
        best = gs[0]
        if best.starter_pts or best.bench:
            who = ", ".join(f"{p.name}" + (f" #{p.jersey}" if p.jersey else "") for p in best.starters[:4])
            if not best.starters:
                who = "bench only: " + ", ".join(p.name for p in best.bench[:3])
            parts.append(f"<tr><td><b>{label}</b></td><td><b>{best.label}</b></td>"
                         f"<td>{_fmt_pts(best.starter_pts)} pts</td><td class=meta>{html.escape(who)}</td></tr>")
        else:
            parts.append(f"<tr><td><b>{label}</b></td><td colspan=3 class=meta>no players of ours</td></tr>")
    parts.append("</table>")
    if unmatched:
        parts.append(f'<div class="warn">No {html.escape(source_label)} projection matched: '
                     + ", ".join(html.escape(f"{p.name} ({p.team} {p.pos})") for p in unmatched)
                     + " — shown with — points; check name/team or whether the source lists them as out.</div>")
    for label, gs in slots:
        parts.append(f"<h2>{label}</h2>")
        parts += [_game_card(g, i) for i, g in enumerate(gs, 1)]
    if idle:
        parts.append("<h2>Not playing this week (bye / unscheduled)</h2><ul>")
        parts += [_player_line(p, not p.starter) for p in idle]
        parts.append("</ul>")
    return "\n".join(parts)



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
