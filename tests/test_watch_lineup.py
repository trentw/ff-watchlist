from ff_watchlist.watch_lineup import parse_lineup


PLAYERS = {
    "caleb": {"full_name": "Caleb Williams", "team": "CHI", "position": "QB", "number": 18, "active": True},
    "gibbs": {"full_name": "Jahmyr Gibbs", "team": "DET", "position": "RB", "number": 0, "active": True},
    "dj": {"full_name": "D.J. Moore", "team": "CHI", "position": "WR", "active": True},
    "old-dj": {"full_name": "D.J. Moore", "team": "CAR", "position": "WR", "active": False},
    "jefferson": {"full_name": "Justin Jefferson", "team": "MIN", "position": "WR", "active": True},
    "amb-a": {"full_name": "Jordan Williams", "team": "CHI", "position": "WR", "active": True},
    "amb-b": {"full_name": "Jordan Williams", "team": "DET", "position": "WR", "active": True},
    "dst": {"full_name": "Chicago Bears", "team": "CHI", "position": "DEF", "number": None, "active": True},
}


def test_csv_yahoo_and_bench_lines_resolve_starters():
    got = parse_lineup(
        "name,team,slot\nCaleb Williams, CHI, QB\nQB  Caleb Williams  Chi - QB\nWR\tD.J. Moore\tCHI\nBN Justin Jefferson MIN - WR",
        PLAYERS,
    )
    assert [p["name"] for p in got["players"]] == ["Caleb Williams", "D.J. Moore", "Justin Jefferson"]
    assert got["players"][0]["jersey"] == "18"
    assert got["players"][2]["slot"] == "BN"
    assert any("duplicate" in i["message"] for i in got["issues"])
    assert not got["warnings"]


def test_simple_name_gets_starter_slot_and_html_is_text_only():
    got = parse_lineup("<tr><td>WR</td><td>D.J. Moore</td><td>CHI</td></tr>\nCaleb Williams", PLAYERS)
    assert [p["name"] for p in got["players"]] == ["D.J. Moore", "Caleb Williams"]
    assert got["players"][1]["slot"] == "STARTER"
    assert not got["issues"]


def test_ambiguity_and_explicit_old_team_are_reported():
    got = parse_lineup("Jordan Williams\nD.J. Moore, CAR, WR", PLAYERS)
    assert not got["players"]
    assert "ambiguous" in got["issues"][0]["message"]
    assert "conflicts" in got["issues"][1]["message"]


def test_dst_full_team_alias_resolves_without_fuzzy_player_matching():
    got = parse_lineup("DST Chicago Bears D/ST", PLAYERS)
    assert got["players"] == [{"id": "dst", "name": "Chicago Bears", "team": "CHI", "pos": "DST", "slot": "DST"}]


def test_zero_jersey_number_is_kept():
    got = parse_lineup("Jahmyr Gibbs, DET, RB", PLAYERS)
    assert got["players"][0]["jersey"] == "0"


def test_multiline_platform_copy_carries_slot_and_team_metadata():
    got = parse_lineup(
        "QB\nCaleb Williams\nCHI - QB\nBN\nJustin Jefferson\nMIN - WR",
        PLAYERS,
    )
    assert [(p["name"], p["slot"], p["team"]) for p in got["players"]] == [
        ("Caleb Williams", "QB", "CHI"),
        ("Justin Jefferson", "BN", "MIN"),
    ]
    assert not got["issues"]


def test_invalid_explicit_csv_team_and_slot_are_not_silently_dropped():
    got = parse_lineup("Caleb Williams, ZZZ, QB\nCaleb Williams, CHI, BNN\nBNN, Caleb Williams, CHI", PLAYERS)
    assert not got["players"]
    assert "unknown team" in got["issues"][0]["message"]
    assert "unknown lineup slot" in got["issues"][1]["message"]
    assert "unknown lineup slot" in got["issues"][2]["message"]


def test_reserve_csv_slot_is_canonical_bench():
    got = parse_lineup("Justin Jefferson, MIN, RESERVE", PLAYERS)
    assert got["players"][0]["slot"] == "BN"
