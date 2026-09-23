# Third-party notices

The MIT license covers this project's code and original assets only. Data, photos, logos and trademarks that the app reads from other services remain the property of their owners and are not relicensed here. FF Watchlist is a non-commercial hobby project and is not affiliated with or endorsed by the NFL, Sleeper, RotoWire, ESPN or any fantasy platform.

## Sources in use

| Source | Used for | Notes |
|---|---|---|
| Sleeper API (`api.sleeper.app`) | Player directory, current week | Documented, read-only, free for non-commercial use per Sleeper's API docs. |
| Sleeper league reads (`api.sleeper.app`) | Optional lineup import | Called from the visitor's browser with the username they type; never through this project's servers. Documented, read-only. |
| Sleeper weekly projections | Projected points | Undocumented endpoint; rows are attributed to RotoWire. Always shown with attribution and fetch time. |
| ESPN scoreboard (`site.api.espn.com`) | Schedule, kickoff times, networks | Undocumented public endpoint. |
| Sleeper image CDN (`sleepercdn.com`) | Optional team logos and headshots | Linked from the owner's CDN at display time; never copied into this repository or a deployment. |
| Yahoo Fantasy Sports API (`fantasysports.yahooapis.com`) | Experimental, disabled league import | Requires OAuth and approval for the intended audience. The current production feature flag is off. See [integration checklist](docs/yahoo-import.md) before enabling or displaying Yahoo Fantasy information. |

## Analytics

The hosted site uses Cloudflare Web Analytics, which Cloudflare adds at the edge. It counts page views and load timings without cookies and never sees a lineup. It is not part of this repository's code; the content security policy in `web/_headers` is what permits it.

## Rules for contributors

- Keep provider responses out of the repository. Tests and fixtures use synthetic data.
- Show the source and its fetch time wherever provider numbers appear.
- Images are optional. Every view must work with text, team colors and jersey numbers alone, and a deployment must be able to turn images or a data source off without a code change.
- When adding a source, record its terms, attribution and the exact integration surface in the table above.

## Removal requests

Rights holders who want content removed from a deployment can open an issue on this repository; image and data sources can be disabled promptly.
