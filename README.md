# FF Watchlist

Find the NFL games that matter to your fantasy lineup. Add your starters and
bench, choose scoring, and get every game ranked within its kickoff window.
Starter projected points lead; bench points break ties. The interface takes
inspiration from vintage tabletop football.

Live at [ffwatchlist.com](https://ffwatchlist.com). No account, and your lineup
never leaves your browser.

## How it works

The site is static. A scheduled job collects the shared facts for the current
week (player directory, schedule, projections) and publishes them as a small
JSON bundle. The page loads that bundle and does the rest locally: player
search, lineup matching, ranking and a saved lineup in `localStorage`.

```text
providers -> ff-watchlist export -> web/dist/data/*.json -> browser app
```

## Run locally

Requires Python 3.12+ with [uv](https://docs.astral.sh/uv/) and Node 22.18+.

```sh
uv sync --locked
npm ci
npm run build                      # web/dist
uv run ff-watchlist export --demo  # web/dist/data, synthetic and offline
uv run ff-watchlist serve          # http://127.0.0.1:8793
```

Drop `--demo` to collect the current week from the live providers described in
the [source notes](THIRD_PARTY.md). Responses are cached under ignored `data/`.
`--no-headshots` and `--no-logos` publish a bundle that tells the app not to
load those images.

## What it does

- Search players by name, or paste names, roster text or CSV; ambiguous and
  unknown names are reported instead of guessed.
- Standard, half-PPR and PPR scoring.
- Starters, bench, byes and missing projections stay distinguishable; a
  missing projection is never counted as zero.
- Kickoff times in your timezone; finished games are dimmed.
- The lineup is saved in your browser and can be shared as a link.
- Team logos and headshots are optional and fail independently of rankings.

Not yet: importing a lineup from a fantasy platform, custom league scoring,
multiple leagues.

## Contribute

```sh
uv run python scripts/install_hooks.py
uv run python scripts/check.py
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md),
[architecture](docs/architecture.md) and [CHANGELOG.md](CHANGELOG.md).
Hooks are opt-in and are not a replacement for review.

## License

Code is [MIT licensed](LICENSE). Provider data, photos and trademarks have
separate terms; the code license grants no rights to those assets.
