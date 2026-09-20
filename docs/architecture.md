# Architecture

FF Watchlist is a Python 3.12+ FastAPI application packaged under `src/ff_watchlist`. The current slice is intentionally small: a deterministic watchlist core, source and lineup adapters, media handling, a public response boundary, and a static HTML/CSS/JavaScript client.

## Module boundaries

- `watch_core` owns the domain model and watchlist decisions. It should remain deterministic and straightforward to test.
- `watch_lineup` translates lineup or roster inputs into the domain model. It must not make presentation decisions.
- `watch_sources` contains provider adapters and provenance metadata. Network access belongs here and is optional at runtime.
- `watch_media` handles image and media references, including rights metadata and safe fallbacks.
- `watch_public` is the FastAPI-facing boundary: request parsing, response models, and route composition. It should call existing domain calculations instead of reimplementing them.
- `src/ff_watchlist/watch_public_static/` is the browser surface. It consumes public responses and should degrade gracefully when no provider data is available.

- `web/` holds the browser ranker (`web/src/core.ts`), a TypeScript port of the `watch_core` join and ranking with no runtime dependencies. It exists so a lineup can be ranked without sending it to a server.

## Two rankers, one behavior

`scripts/make_parity_fixtures.py` runs a set of cases through the Python core and writes inputs and expected output to `tests/parity/rank_cases.json`. A pytest check fails if that file is stale, and the Node tests require the browser ranker to reproduce it. The one deliberate difference is presentation: the browser keys kickoff windows by UTC hour and labels them in the viewer's timezone, while the Python core labels them in Pacific time. The games in each window are the same.

## Data flow

```text
provider/source -> sources -> lineup -> watch_core -> public -> static client
                                      \-> media metadata -/
```

The application should be usable with deterministic fixtures and no network. Provider integrations therefore need explicit boundaries, timeouts, and provenance; a missing or unavailable source should produce a clear degraded result rather than fabricated data.

## Rights and publication

The repository's MIT license covers project code and original assets only. Provider data and imagery stay with their owners: responses are cached outside the repository, results carry attribution and fetch time, and images are linked from the owner's CDN rather than copied. See `THIRD_PARTY.md`.

## Tooling

Development uses uv, pytest, and Ruff (`E9` and `F`); browser code uses TypeScript for type checking and Node's built-in test runner. The `uv run ff-watchlist` entry point defaults to `127.0.0.1:8793`; `--demo` is synthetic and fully offline. Install opt-in hooks through `scripts/install_hooks.py`: pre-commit checks tracked-file hygiene, Ruff, and offline pytest, while commit-msg rejects AI co-author trailers and permits human co-authors. `scripts/check.py` is the local aggregate check.
