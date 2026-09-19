from pathlib import Path

from ff_watchlist.watch_media import PublicMedia


class Response:
    def __init__(self, value):
        self.value = value

    def raise_for_status(self):
        return None

    def json(self):
        return self.value


def test_lookup_parses_team_media_and_verified_headshot_once(tmp_path: Path):
    calls = []
    payloads = {
        "teams": {
            "sports": [{"leagues": [{"teams": [{"team": {
                "abbreviation": "CHI", "displayName": "Chicago Bears", "color": "0B162A",
                "logos": [{"rel": ["full", "default"], "href": "https://a.espncdn.com/i/teamlogos/nfl/500/chi.png"}],
            }}, {"team": {
                "abbreviation": "DET", "displayName": "Detroit Lions", "color": "0076B6",
                "logos": [{"rel": ["full", "default"], "href": "https://a.espncdn.com/i/teamlogos/nfl/500/det.png"}],
            }}]}]}]
        },
        "roster": {"athletes": [{"position": "offense", "items": [{
            "id": "4431611", "fullName": "Caleb Williams",
            "headshot": {"href": "https://a.espncdn.com/i/headshots/nfl/players/full/4431611.png"},
        }]}]},
    }

    def get(url, **kwargs):
        calls.append(url)
        return Response(payloads["teams"] if url.endswith("/teams") else payloads["roster"])

    media = PublicMedia(tmp_path, http_get=get)
    rows = [{"name": "Caleb Williams", "team": "CHI", "espn_id": "4431611"},
            {"name": "Caleb Williams", "team": "CHI", "espn_id": "4431611"}]
    result = media.lookup(rows)
    assert result["teams"] == {
        "CHI": {"name": "Chicago Bears", "logo": "https://a.espncdn.com/i/teamlogos/nfl/500/chi.png", "color": "0B162A"},
        "DET": {"name": "Detroit Lions", "logo": "https://a.espncdn.com/i/teamlogos/nfl/500/det.png", "color": "0076B6"},
    }
    assert result["players"]["calebwilliams|CHI"]["headshot"].endswith("4431611.png")
    assert calls.count("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams") == 1
    assert len(calls) == 2  # team metadata + one roster request for duplicate rows


def test_lookup_rejects_untrusted_image_url_and_degrades(tmp_path: Path):
    def get(url, **kwargs):
        if url.endswith("/teams"):
            return Response({"sports": [{"leagues": [{"teams": [{"team": {
                "abbreviation": "MIN", "displayName": "Minnesota Vikings", "color": "4F2683",
                "logos": [{"href": "http://evil.example/logo.png"}],
            }}]}]}]})
        return Response({"athletes": [{"items": [{"fullName": "Justin Jefferson",
            "headshot": {"href": "https://evil.example/player.png"}}]}]})

    result = PublicMedia(tmp_path, http_get=get).lookup([{"name": "Justin Jefferson", "team": "MIN"}])
    assert result["teams"]["MIN"]["logo"] is None
    assert result["players"] == {}
    assert result["warnings"] == []


def test_lookup_missing_upstream_is_nonfatal(tmp_path: Path):
    def get(url, **kwargs):
        raise OSError("offline")

    result = PublicMedia(tmp_path, http_get=get).lookup([{"name": "Jahmyr Gibbs", "team": "DET"}])
    assert result["teams"] == {}
    assert result["players"] == {}
    assert result["warnings"]
