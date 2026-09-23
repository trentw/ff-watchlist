# Yahoo Fantasy import (experimental)

Yahoo import is a local work in progress. The production Worker configuration keeps it disabled. Do not enable it for visitors until Yahoo has approved the intended audience and use, and the release checks below are complete. Approval for a different or narrower use does not authorize a public launch.

The current design keeps the page and ranking logic in the browser. A same-origin Cloudflare Worker handles OAuth and reads the selected roster from Yahoo, because the Fantasy API does not support the browser's cross-origin requests used by this integration. The browser maps the response to the site's player directory and replaces the active lineup when the visitor chooses a team or selects **Update from Yahoo**. The Worker stores an encrypted OAuth connection in a Durable Object, not a roster. Roster and league data pass through the Worker only for the request; the selected Watchlist lineup and Yahoo update shortcut persist in the visitor's browser.

The existing share link contains Watchlist player IDs, lineup slots, and scoring in a URL fragment. It does not contain Yahoo player IDs, league or team names, OAuth credentials, or API responses. Keep Yahoo-specific fields out of that format.

## Setup for an approved deployment

1. Obtain Yahoo Fantasy Sports API approval covering the application's intended users and display of Fantasy information. Review the full applicable agreement and developer attribution requirements before enabling the feature.
2. Register a Yahoo OAuth public client with Fantasy read access and the exact HTTPS callback URL for the deployment: `/api/yahoo/callback` on the application's origin. Use Authorization Code with PKCE. Keep the client ID in the Worker environment; do not put credentials, tokens, roster responses, or real league data in the repository.
3. Deploy the static assets and same-origin Worker from this repository. Configure `APP_ORIGIN` and `YAHOO_REDIRECT_URI` for that origin and apply the `YahooSession` Durable Object migration in `wrangler.jsonc`. Provision `YAHOO_CLIENT_ID`, `YAHOO_TOKEN_KEY`, and `YAHOO_COOKIE_KEY` as Worker secrets. Generate independent random 32-byte keys, encoded as base64url, for the two key secrets. Keep `YAHOO_ENABLED=false` until the release gates below pass.
4. Configure deployment credentials outside the repository, following [Deploying](deploying.md). Use a separate, limited staging token or deployment when testing. Never put secret values in tracked config, documentation, logs, fixtures, or screenshots.
5. On every page that displays Yahoo Fantasy information, add the required Yahoo Fantasy attribution in the footer with a link to an official Yahoo Fantasy page. Review source and trademark notes in `THIRD_PARTY.md` and update public copy to describe the final data flow accurately.

## Release gates

- Confirm that Yahoo's approval covers access by the intended visitors. Keep the production feature disabled until then.
- Keep Yahoo API roster and league responses off server-side storage: no Worker, Durable Object, cache, log, analytics, or telemetry persistence of those responses or mapped lineups. Only the visitor's browser saves the selected Watchlist lineup and the minimum Yahoo metadata needed to update it. The encrypted OAuth connection is the separate, bounded server-side state needed to call Yahoo; disconnect must delete it.
- Keep Yahoo player IDs, league and team names, OAuth credentials, and API responses out of share links, analytics, logs, and public fixtures. Preserve the existing Watchlist-only share-link format. If the approval for the intended audience imposes a specific browser-storage limit, implement it before enabling the feature; this checklist does not impose a new expiry on local lineup state.
- Complete attribution, privacy copy, `README.md`, `THIRD_PARTY.md`, and `CHANGELOG.md` updates.
- Run offline Python and browser checks and review the complete staged diff for secrets and personal data. Test keyboard use and a narrow viewport.
- On an approved test account and deployment, verify OAuth connection, team selection, starter/bench mapping, scoring behavior, ranking, reload, one-click update, disconnect, and error handling. Compare results with Yahoo without recording real roster contents in the repository. Repeat the smoke test on the intended production origin before switching the feature on.
- Remove temporary OAuth callbacks, staging deployments, domains, tokens, and stored test connections when testing is finished.

This checklist describes integration work; it is not evidence of Yahoo approval or a release authorization.
