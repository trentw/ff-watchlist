# Contributing

Small, focused contributions are welcome. Before editing, read `AGENTS.md` and `docs/architecture.md` so changes stay aligned with the package boundaries.

## Local checks

The project uses Python 3.12+, uv, pytest, and Ruff. Run the offline checks before opening a change:

```sh
uv run python scripts/check.py
uv run pytest -q
uv run ruff check --select E9,F .
```

Install opt-in hooks with `uv run python scripts/install_hooks.py`. The pre-commit hook checks tracked-file hygiene, Ruff, and offline pytest; the commit-msg hook rejects AI co-author trailers but permits human co-authors. There is no CI requirement yet, so local checks are the source of truth for this slice.

`uv run ff-watchlist` serves on `127.0.0.1:8793` by default. Use `--demo` for synthetic, fully offline data. The frozen 2026 week 2 example is a clearly labeled demo; choose the actual season and week when using real data.

## Scope and dependencies

Keep modules small and preserve the boundaries described in the architecture document. Avoid new dependencies. If one is necessary, explain why in the change and update the project metadata and documentation together.

Tests must not require network access, credentials, or a live fantasy provider. Add fixtures or deterministic adapters instead.

## Data and media

Record source provenance when adding an adapter or fixture. Undocumented Sleeper RotoWire projections and ESPN imagery are local experimental inputs only; they are never covered by this repository's MIT license. Any permission to publish them must come separately from their rights holders. Do not publish them in a release or public static bundle.

## Commits and reviews

Use a short imperative commit subject and keep each commit focused. Pull request descriptions should briefly state the behavior changed and the checks run. Do not add AI attribution or AI `Co-authored-by` trailers; human co-authors are welcome.
