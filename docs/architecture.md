# Architecture

FF Watchlist is a static site plus a small Python collector. There is no application server: the only thing that differs between visitors is their lineup, and that is handled in the browser.

```text
Sleeper, ESPN -> watch_sources -> export -> web/dist/data/*.json
                                                   |
                       web/src (search, lineup, core) -> rendered page
```

## Python: `src/ff_watchlist`

- `watch_sources` holds the provider adapters. All network access lives here, with timeouts, dated caches under `data/` and provenance; an unusable response raises `SourceUnavailable` rather than producing invented data.
- `export` turns one week of source data into the bundle: a slim player directory, schedule rows, projection rows and a manifest with sources, fetch times and image switches. The bundle is staged and validated as a whole and only then replaces the previous one. Outside the regular season it is a manifest alone.
- `watch_core` (projection join and ranking) and `watch_lineup` (paste parser) are the reference implementations of the browser logic.
- `demo` supplies authored data so everything runs offline.
- `cli` exposes `export` and `serve`.

## Browser: `web/`

TypeScript with no runtime dependencies, bundled by esbuild.

- `core.ts` joins projections and ranks games. Kickoff windows are keyed by UTC hour, so the same games compete in every timezone; only labels use the viewer's timezone.
- `lineup.ts` parses pasted rosters against the directory.
- `search.ts`, `roster.ts` provide player search, the saved lineup and share links.
- `data.ts` loads the bundle; `app.ts` wires the page. Pasted and provider text is only ever written as text nodes.

## Two implementations, one behavior

`scripts/make_parity_fixtures.py` runs cases through the Python core and parser and writes inputs and expected output to `tests/parity/`. A pytest check fails if those files are stale, and the Node tests require the browser code to reproduce them, including issue messages. The one deliberate difference is presentation: the Python core labels windows in Pacific time.

## Publishing

`npm run build` writes the site to `web/dist`; `ff-watchlist export` writes `web/dist/data`. A scheduled GitHub Actions workflow does both and deploys the directory to Cloudflare. A failed or invalid collection deploys nothing, so the last good bundle stays live and its age stays visible on the page.

## Rights

The MIT license covers project code and original assets only. Provider data and imagery stay with their owners: responses are cached outside the repository, results carry attribution and fetch time, and images are linked from the owner's CDN rather than copied. See `THIRD_PARTY.md`.

## Tooling

uv, pytest and Ruff (`E9`, `F`) for Python; TypeScript type checking and Node's test runner for the browser. `scripts/check.py` runs everything and backs the opt-in pre-commit hook; the commit-msg hook rejects AI co-author trailers.
