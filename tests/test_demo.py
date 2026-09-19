from fastapi.testclient import TestClient
from ff_watchlist.demo import DemoSources, DemoMedia
from ff_watchlist.watch_public import create_app


def test_offline_demo_matches_ranks_and_serves_assets():
    client = TestClient(create_app(DemoSources(), DemoMedia()))
    assert client.get("/").status_code == 200
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/styles.css").status_code == 200
    response = client.post("/api/watch", json={
        "lineup": "QB Caleb Williams CHI - QB\nRB Jahmyr Gibbs DET - RB\nWR Ja’Marr Chase CIN - WR\nBN Justin Jefferson MIN - WR",
        "season": 2026, "week": 2, "scoring": "half",
    })
    assert response.status_code == 200
    result = response.json()
    assert result["source"] == "synthetic-demo"
    assert result["issues"] == []
    assert [game["starter_pts"] for game in result["slots"][0]["games"]] == [32, 14]
    assert result["slots"][0]["games"][1]["bench_pts"] == 13
    assert client.post("/api/media", json={"players": result["players"]}).status_code == 200
