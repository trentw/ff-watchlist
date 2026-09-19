"""Authored sample data, not real projections or a real NFL schedule."""
from .watch_sources import SourceUnavailable

PLAYERS = [
    ("Caleb Williams", "CHI", "QB", 18, 18, 18),
    ("Jahmyr Gibbs", "DET", "RB", 12, 14, 16),
    ("Ja’Marr Chase", "CIN", "WR", 11, 14, 17),
    ("Justin Jefferson", "MIN", "WR", 10, 13, 16),
]


class DemoSources:
    def players(self):
        return {str(i): {"full_name": name, "team": team, "position": pos}
                for i, (name, team, pos, *_) in enumerate(PLAYERS)}

    def projections(self, season, week, scoring, source="sleeper"):
        self._validate(season, week)
        return {
            "rows": [{"name": name, "team_id": team, "position_id": pos,
                      "stats": {"points": std, "points_half": half, "points_ppr": ppr}}
                     for name, team, pos, std, half, ppr in PLAYERS],
            "source": "synthetic-demo",
            "attribution": "Authored example values, not real projections",
            "fetched_at": None,
            "warnings": ["OFFLINE DEMO: fictional schedule and points for 2026 week 2."],
        }

    def schedule(self, season, week):
        self._validate(season, week)
        return [{"away": away, "home": home, "kick_utc": "2026-09-20T17:00Z", "network": "Demo"}
                for away, home in [("CHI", "DET"), ("CIN", "MIN")]]

    @staticmethod
    def _validate(season, week):
        if (season, week) != (2026, 2):
            raise SourceUnavailable("Offline fixtures cover 2026 week 2 only")


class DemoMedia:
    def lookup(self, players):
        return {"teams": {}, "players": {}, "warnings": []}
