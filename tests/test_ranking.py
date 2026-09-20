import datetime as dt
from ff_watchlist import watch_core as watch
PT = watch.PACIFIC

def _kick(day, h, m=0):
    return dt.datetime(2026, 9, day, h, m, tzinfo=PT)

def test_slot_buckets_collapse_same_hour():
    assert watch.slot_key(_kick(20, 13, 5)) == watch.slot_key(_kick(20, 13, 25))
    assert watch.slot_key(_kick(20, 10)) != watch.slot_key(_kick(20, 13, 5))
    assert watch.slot_label(_kick(20, 17, 20)) == "Sun 5pm"
    assert watch.slot_label(_kick(20, 10)) == "Sun 10am"

def test_rank_slots_starters_then_bench_tiebreak():
    st = watch.Player("A", "CIN", "WR", "WR", proj=11.0)
    bn = watch.Player("B", "MIN", "WR", "BN", proj=7.0)
    big_bench = watch.Player("C", "GB", "RB", "BN", proj=9.0)
    g_st = watch.Game("CIN", "TB", _kick(20, 13, 5), starters=[st])
    g_bn = watch.Game("MIN", "CHI", _kick(20, 13, 25), bench=[bn])
    g_bigbn = watch.Game("GB", "DET", _kick(20, 13, 25), bench=[big_bench])
    g_none = watch.Game("NYJ", "MIA", _kick(20, 13, 0))
    g_thu = watch.Game("DET", "BUF", _kick(17, 17, 15), starters=[watch.Player("K", "DET", "K", "K", proj=7.0)])
    slots = watch.rank_slots([g_none, g_bn, g_st, g_bigbn, g_thu])
    assert [s[0] for s in slots] == ["Thu 5pm", "Sun 1pm"]
    sun = slots[1][1]
    # starters beat any bench; bigger bench beats smaller; a bench player beats nobody
    assert [g.label for g in sun] == ["CIN @ TB", "GB @ DET", "MIN @ CHI", "NYJ @ MIA"]
    assert sun[0].starter_pts == 11.0 and sun[1].starter_pts == 0.0

def test_attach_projections_by_name_team_and_dst_by_team():
    ps = [
        watch.Player("Ja'Marr Chase", "CIN", "WR", "WR"),
        watch.Player("Jaguars", "JAX", "DST", "DEF"),
        watch.Player("A.J. Brown", "NE", "WR", "WR"),  # no projection this week
    ]
    proj = [
        {"name": "Ja'Marr Chase", "team_id": "CIN", "position_id": "WR",
         "stats": {"points": 11.01, "points_half": 14.28}},
        {"name": "Jacksonville Jaguars", "team_id": "JAC", "position_id": "DST",
         "stats": {"points": 5.56, "points_half": 5.56}},
    ]
    unmatched = watch.attach_projections(ps, proj, "half")
    assert ps[0].proj == 14.28 and ps[1].proj == 5.56
    assert [p.name for p in unmatched] == ["A.J. Brown"]

def test_build_games_routes_starters_bench_and_bye():
    sched = [{"away": "CIN", "home": "TB", "kick_utc": "2026-09-20T17:00Z", "network": "CBS"}]
    ps = [watch.Player("A", "CIN", "WR", "WR", proj=1), watch.Player("B", "TB", "RB", "BN", proj=2),
          watch.Player("C", "KC", "QB", "QB", proj=3)]
    games, idle = watch.build_games(ps, sched)
    assert games[0].starters == [ps[0]] and games[0].bench == [ps[1]] and idle == [ps[2]]
    assert games[0].kick.hour == 10 and games[0].kick.tzinfo is not None

def test_team_aliases_match_projections_and_schedule():
    ps = [watch.Player("Jaguars", "JAC", "DST", "DEF"), watch.Player("A", "WSH", "WR", "WR")]
    proj = [{"name": "Jacksonville Jaguars", "team_id": "JAX", "position_id": "DST", "stats": {"points": 6.5}},
            {"name": "A", "team_id": "WAS", "position_id": "WR", "stats": {"points": 9.0}}]
    assert watch.attach_projections(ps, proj, "std") == []
    games, idle = watch.build_games(ps, [{"away": "JAC", "home": "WSH", "kick_utc": "2026-09-20T17:00Z", "network": ""}])
    assert idle == [] and (games[0].away, games[0].home) == ("JAX", "WAS")
    assert games[0].starter_pts == 15.5
