# FF Watchlist contributor guide

FF Watchlist is a small FastAPI service for assembling a fantasy-football watchlist. Keep changes narrow, readable, and easy to run offline.

## Layout

- `src/ff_watchlist/` contains the application package and its `watch_core`, `watch_lineup`, `watch_sources`, `watch_media`, and `watch_public` modules.
- `src/ff_watchlist/watch_public_static/` contains the current HTML, CSS, and JavaScript surface.
- `web/` contains the TypeScript browser ranker and its tests. It has no runtime dependencies.
- `tests/` contains offline tests; `tests/parity/` holds ranking cases shared with `web/`.
- `docs/` contains project architecture and contributor-facing notes.
- `PROJECT-PLAN.md` and `.local/` are private internal notes and should remain untracked.

## Development

Use Python 3.12+ and uv. Install the project in the usual uv workflow, then run:

```sh
uv run python scripts/check.py
uv run pytest -q
uv run ruff check --select E9,F .
```

Browser code needs Node 22.18+: run `npm ci`, then `npm run check` (type check and tests; `scripts/check.py` includes it once installed). After changing ranking behavior, regenerate the shared cases with `uv run python scripts/make_parity_fixtures.py` and keep both suites passing.

Tests must be offline. The `uv run ff-watchlist` command defaults to `127.0.0.1:8793`; `--demo` uses synthetic, fully offline data. The frozen 2026 week 2 example is retained as a clearly labeled demo; users select the actual season and week for real use. Do not add dependencies unless the change clearly requires one and the dependency is documented. Install opt-in hooks through `uv run python scripts/install_hooks.py`: pre-commit checks tracked-file hygiene, Ruff, and offline pytest; commit-msg rejects AI co-author trailers while allowing human co-authors.

## Source and media rights

Source provenance must be explicit. Undocumented Sleeper RotoWire projections and ESPN imagery are not licensed by the MIT project license; treat them as local experimental inputs only until publication rules are resolved. Do not ship them as public project assets.

## Change hygiene

Add or update tests for behavior that matters, keep public API changes documented, and update `CHANGELOG.md` for user-visible changes. There is no CI requirement at this slice. Commit messages and pull request descriptions should be brief; do not add AI `Co-authored-by` trailers. Human co-authors are allowed.

## Maintenance rules

- Read README, CONTRIBUTING and the relevant module before editing. Keep this
  file short; put enduring design explanations in docs/architecture.md.
- Reuse the core calculation rather than restating ranking in a new surface.
  The Python core and `web/src/core.ts` are the only two rankers; the parity
  cases keep them identical.
  Missing points are not zero, bench points only break starter ties, and name
  ambiguity must remain explicit. Preserve timezone-aware kickoff grouping.
- Keep provider I/O outside the core. Date caches, preserve real source times,
  and test failures with synthetic fixtures. Never silently substitute scoring.
- Treat pasted input as untrusted; render names as text. Never log roster
  bodies or commit credentials, provider caches, personal plans or local paths.
- Verify UI changes with keyboard use and a narrow viewport. Media failure
  must not stop rankings. Avoid unrelated refactors or mandatory new tooling.
- Before committing, run the local checks and inspect the staged diff. Update
  Unreleased for notable changes; at release, use a dated version section and
  retain only applicable Added/Changed/Deprecated/Removed/Fixed/Security groups.
- Keep commits and PR descriptions brief: state the change, why when needed,
  and relevant verification. Never add AI coauthor attribution.
- Public docs must stand on their own. Do not link contributor instructions to
  ignored private plans or require personal journals/handoff ceremonies.
