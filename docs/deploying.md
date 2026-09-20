# Deploying

The site is a directory of static files, so any static host works. This repository deploys to [Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/) from GitHub Actions.

## What the workflows do

- `check.yml` runs the Python and browser checks on pull requests and on `main`.
- `publish.yml` builds the site, exports the current week and runs `wrangler deploy`. It runs every four hours, on pushes to `main`, and on demand. The export validates the whole bundle first; if a provider is down or returns unusable data the job fails before deploying, and the previous deployment stays live with its age shown on the page.

## Setup for your own copy

1. Create a Cloudflare API token with the *Workers Scripts: Edit* permission for your account.
2. Add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. Change `name` in `wrangler.jsonc` if you want a different Worker name, and attach a custom domain to the Worker in the Cloudflare dashboard.

## Switching images off

Set the repository variable `SHOW_HEADSHOTS` or `SHOW_LOGOS` to `false` and run the Publish workflow. The next bundle tells the app not to request those images; no code change or rebuild of the app is involved. Cards fall back to jersey numbers, positions and team colors.

## Off-season

Outside the regular season the export has no current week and the scheduled job fails without deploying. Disable the Publish workflow until the season starts. GitHub also pauses scheduled workflows after 60 days without repository activity; re-enable it from the Actions tab.

## By hand

```sh
npm run build
uv run ff-watchlist export
npx wrangler deploy
```
