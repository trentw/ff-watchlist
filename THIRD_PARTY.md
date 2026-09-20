# Third-party notices

The MIT license covers this project's code and original assets only. Data, photos, logos and trademarks that the app reads from other services remain the property of their owners and are not relicensed here. FF Watchlist is a non-commercial hobby project and is not affiliated with or endorsed by the NFL, Sleeper, RotoWire, ESPN or any fantasy platform.

## Sources in use

| Source | Used for | Notes |
|---|---|---|
| Sleeper API (`api.sleeper.app`) | Player directory, current week | Documented, read-only, free for non-commercial use per Sleeper's API docs. |
| Sleeper weekly projections | Projected points | Undocumented endpoint; rows are attributed to RotoWire. Always shown with attribution and fetch time. |
| ESPN scoreboard (`site.api.espn.com`) | Schedule, kickoff times, networks | Undocumented public endpoint. |
| ESPN and Sleeper image CDNs | Optional team logos and headshots | Linked from the owner's CDN at display time; never copied into this repository or a deployment. |

## Rules for contributors

- Keep provider responses out of the repository. Tests and fixtures use synthetic data.
- Show the source and its fetch time wherever provider numbers appear.
- Images are optional. Every view must work with text, team colors and jersey numbers alone, and a deployment must be able to turn images or a data source off without a code change.
- When adding a source, record its terms, attribution and the exact integration surface in the table above.

## Removal requests

Rights holders who want content removed from a deployment can open an issue on this repository; image and data sources can be disabled promptly.
