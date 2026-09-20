# Contributing

Small, focused contributions are welcome. Before editing, read `AGENTS.md` and `docs/architecture.md` so changes stay aligned with the package boundaries.

## Local checks

The project uses Python 3.12+, uv, pytest, and Ruff. Run the offline checks before opening a change:

```sh
uv run python scripts/check.py
uv run pytest -q
uv run ruff check --select E9,F .
```

The browser app in `web/` is TypeScript with no runtime dependencies. With Node 22.18+:

```sh
npm ci
npm run check
```

`scripts/check.py` runs these too once `node_modules/` exists. The Python and browser implementations must agree: the cases in `tests/parity/` are generated from the Python modules by `uv run python scripts/make_parity_fixtures.py`, and both test suites read them. Change ranking or parsing behavior in both places, regenerate, and commit the result.

Install opt-in hooks with `uv run python scripts/install_hooks.py`. The pre-commit hook checks tracked-file hygiene, Ruff, and offline pytest; the commit-msg hook rejects AI co-author trailers but permits human co-authors. There is no CI requirement yet, so local checks are the source of truth for this slice.

To see the site, run `npm run build`, `uv run ff-watchlist export --demo` and `uv run ff-watchlist serve`, then open `http://127.0.0.1:8793`. For UI changes, check keyboard use and a phone-width viewport.

## Scope and dependencies

Keep modules small and preserve the boundaries described in the architecture document. Avoid new dependencies. If one is necessary, explain why in the change and update the project metadata and documentation together.

Tests must not require network access, credentials, or a live fantasy provider. Add fixtures or deterministic adapters instead.

## Data and media

Record source provenance when adding an adapter or fixture, and list new sources in [THIRD_PARTY.md](THIRD_PARTY.md). Provider data and imagery are not covered by the MIT license: keep provider responses out of the repository, use synthetic fixtures, and keep images optional so any source can be switched off.

## Commits and reviews

Use a short imperative commit subject and keep each commit focused. Pull request descriptions should briefly state the behavior changed and the checks run. Do not add AI attribution or AI `Co-authored-by` trailers; human co-authors are welcome.
