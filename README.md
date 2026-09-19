# FF Watchlist

Find the NFL games that matter to your fantasy lineup. Paste your starters
and bench, choose scoring, and get games ranked within each kickoff window.
Starter projected points lead; bench points break ties. The interface takes
inspiration from vintage tabletop football.

## Run locally

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```sh
uv sync --locked
uv run ff-watchlist --demo
```

Open http://127.0.0.1:8793 and choose **Try an example lineup**, then **Find my
matchups**. Offline demo mode uses authored points and a fictional schedule
for **2026 week 2**; it makes no provider requests and loads no external images.

For the experimental public-source adapters:

```sh
uv run ff-watchlist
```

Choose the actual season and week yourself: the initial form is deliberately
set to the reproducible 2026 week 2 example, not an automatic current-week guess.
This mode fetches Sleeper player/projection data and ESPN schedules and optional
imagery. Provider caches are dated under ignored `data/`. Public access does not
establish redistribution rights; see [source notes](THIRD_PARTY.md) before hosting.
`--host` and `--port` configure the listener; the default binds only to localhost.

## Current capabilities

- Paste names, roster text or CSV; unresolved identities remain visible.
- Standard, half-PPR and PPR presets; optional `name,team,points` projection CSV.
- Starters, bench, byes and missing projections remain distinguishable.
- Optional team logos and headshots fail independently of the rankings.
- Explicit share links include the lineup and any pasted projections.

No accounts, saved rosters, automatic league imports or static deployment yet.
The local server receives lineups to calculate results but does not save them.
The CSV fallback still needs directory/schedule data in public-source mode.

## Contribute

```sh
uv sync --locked
uv run python scripts/install_hooks.py
uv run python scripts/check.py
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md),
[architecture](docs/architecture.md) and [CHANGELOG.md](CHANGELOG.md).
Hooks are opt-in and are not a replacement for review. Internal planning lives
in ignored `PROJECT-PLAN.md` and `.local/`; contributors need neither.

## License

Code is [MIT licensed](LICENSE). Provider data, photos and trademarks have
separate terms; the code license grants no rights to those assets.
