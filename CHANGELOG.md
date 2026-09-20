# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and releases use semantic versioning.

## [Unreleased]

### Added

- Static browser app: player search, roster paste, starter and bench toggles,
  a lineup saved in the browser, share links, kickoff times in the viewer's
  timezone, visible data age and optional team logos and headshots.
- `ff-watchlist export` writes a validated weekly data bundle; `ff-watchlist
  serve` previews the built site. `--demo` data is synthetic and offline.
- When a new week begins, a saved lineup asks once to be reviewed and flags
  players who changed teams or are not playing.
- Outside the regular season the export publishes a manifest alone and the
  page says so, keeping the saved lineup.
- Shared parity cases hold the TypeScript ranking and lineup parsing to the
  Python reference implementations.
- Contributor guidance and opt-in code-quality and commit-message hooks.

### Removed

- The FastAPI server and its page; lineups are no longer sent to a server.
  Pasting your own projection CSV went with it.

### Fixed

- Team aliases such as `JAC` and `WSH` on players or schedule rows now match
  projections and games instead of leaving the player unmatched.
