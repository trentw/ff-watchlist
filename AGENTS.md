# FF Watchlist contributor guide

FF Watchlist has a static browser app, a small Python collector, and an optional same-origin Worker for Yahoo import. It ranks NFL games by a visitor's fantasy lineup in the browser. Keep changes narrow, readable, and easy to run offline.

## Layout

- `src/ff_watchlist/` is the collector: `watch_sources` (provider adapters), `export` (data bundle), `watch_core` and `watch_lineup` (reference ranking and parsing), `demo` and `cli`.
- `web/` is the browser app: TypeScript with no runtime dependencies, plus `index.html` and `styles.css`.
- `tests/` contains offline tests; `tests/parity/` holds ranking cases shared with `web/`.
- `docs/` contains project architecture and contributor-facing notes.

## Development

Use Python 3.12+ and uv. Install the project in the usual uv workflow, then run:

```sh
uv run python scripts/check.py
uv run pytest -q
uv run ruff check --select E9,F .
```

Browser code needs Node 22.18+: run `npm ci`, then `npm run check` (type check and tests; `scripts/check.py` includes it once installed). After changing ranking behavior, regenerate the shared cases with `uv run python scripts/make_parity_fixtures.py` and keep both suites passing.

Tests must be offline. `npm run build`, `uv run ff-watchlist export --demo` and `uv run ff-watchlist serve` give a fully offline site at `127.0.0.1:8793`; the demo data is synthetic and labeled as such. Do not add dependencies unless the change clearly requires one and the dependency is documented. Install opt-in hooks through `uv run python scripts/install_hooks.py`: pre-commit checks tracked-file hygiene, Ruff, and offline pytest; commit-msg rejects AI co-author trailers while allowing human co-authors.

## Source and media rights

Source provenance must be explicit; `THIRD_PARTY.md` lists every source and how it is used. Provider data and imagery are not covered by the MIT license. Never commit provider responses or images, show attribution and fetch time with provider numbers, and keep images optional so a source can be switched off.

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
- Keep weekly bundle collection I/O in `watch_sources`. Sleeper lineup import calls its public API from the browser; the optional Yahoo Worker handles OAuth and transient roster reads. Date caches, preserve real source times,
  and test failures with synthetic fixtures. Never silently substitute scoring.
- Treat pasted and provider text as untrusted; render it as text nodes only.
  A saved Watchlist lineup must stay in the browser. The Yahoo Worker may pass a requested Yahoo roster through to that browser, but must not store or log it. Never commit credentials, provider caches, personal plans or local paths.
- Verify UI changes with keyboard use and a narrow viewport. Media failure
  must not stop rankings. Avoid unrelated refactors or mandatory new tooling.
- Before committing, run the local checks and inspect the staged diff. Update
  Unreleased for notable changes; at release, use a dated version section and
  retain only applicable Added/Changed/Deprecated/Removed/Fixed/Security groups.
- Keep commits and PR descriptions brief: state the change, why when needed,
  and relevant verification. Never add AI coauthor attribution.
- Public docs must stand on their own; never reference untracked notes.
