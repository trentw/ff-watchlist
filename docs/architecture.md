# Architecture

FF Watchlist has a static page, a small Python collector, and an optional same-origin Worker for Yahoo import. The production Yahoo feature flag is off. Ranking and the saved lineup stay in the browser.

```text
Sleeper, ESPN -> watch_sources -> export -> web/dist/data/*.json
                                                   |
                       web/src (search, lineup, core) -> rendered page
```

## Python: `src/ff_watchlist`

- `watch_sources` holds the weekly bundle's provider adapters. Collection network access lives here, with timeouts, dated caches under `data/` and provenance; an unusable response raises `SourceUnavailable` rather than producing invented data.
- `export` turns one week of source data into the bundle: a slim player directory, schedule rows, projection rows and a manifest with sources, fetch times and image switches. The bundle is staged and validated as a whole and only then replaces the previous one. Outside the regular season it is a manifest alone.
- `watch_core` (projection join and ranking) and `watch_lineup` (paste parser) are the reference implementations of the browser logic.
- `demo` supplies authored data so everything runs offline.
- `cli` exposes `export` and `serve`.

## Browser: `web/`

TypeScript with no runtime dependencies, bundled by esbuild.

- `core.ts` joins projections and ranks games. Kickoff windows are keyed by UTC hour, so the same games compete in every timezone; only labels use the viewer's timezone.
- `lineup.ts` parses pasted rosters against the directory.
- `search.ts`, `roster.ts` provide player search, the saved lineup and share links.
- `sleeper.ts` imports a lineup from Sleeper's public API, called directly from the browser; it is the only request the page makes to a host other than its own.
- `yahoo.ts` maps a roster returned by the optional same-origin Yahoo Worker. The selected lineup and minimal update shortcut are saved in browser storage. See [Yahoo import](yahoo-import.md).
- `data.ts` loads the bundle; `app.ts` wires the page. Pasted and provider text is only ever written as text nodes.

## Two implementations, one behavior

`scripts/make_parity_fixtures.py` runs cases through the Python core and parser and writes inputs and expected output to `tests/parity/`. A pytest check fails if those files are stale, and the Node tests require the browser code to reproduce them, including issue messages. The one deliberate difference is presentation: the Python core labels windows in Pacific time.

## Optional Yahoo Worker

The Worker handles Yahoo OAuth with PKCE and reads the requested roster, because Yahoo's Fantasy API does not allow the browser's cross-origin requests used here. Its Durable Object stores an encrypted OAuth connection for up to 30 days, not a roster. Roster responses pass through to the visitor's browser without server-side persistence. The feature stays disabled until approval covers the intended audience and the [release checklist](yahoo-import.md) is complete.

## Publishing

`npm run build` writes the site to `web/dist`; `ff-watchlist export` writes `web/dist/data`. A scheduled GitHub Actions workflow does both and deploys the directory to Cloudflare. A failed or invalid collection deploys nothing, so the last good bundle stays live and its age stays visible on the page.

## Rights

The MIT license covers project code and original assets only. Provider data and imagery stay with their owners: responses are cached outside the repository, results carry attribution and fetch time, and images are linked from the owner's CDN rather than copied. See `THIRD_PARTY.md`.

## Tooling

uv, pytest and Ruff (`E9`, `F`) for Python; TypeScript type checking and Node's test runner for the browser. `scripts/check.py` runs everything and backs the opt-in pre-commit hook; the commit-msg hook rejects AI co-author trailers.
