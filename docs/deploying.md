# Deploying

The site is a directory of static files, so any static host works. This repository deploys to [Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/) from GitHub Actions.

## What the workflows do

- `check.yml` runs the Python and browser checks on pull requests and on `main`.
- `publish.yml` builds the site, exports the current week and runs `wrangler deploy`. It runs every four hours, on pushes to `main`, and on demand. The export validates the whole bundle first; if a provider is down or returns unusable data the job fails before deploying, and the previous deployment stays live with its age shown on the page.

## Setup for your own copy

1. Create a Cloudflare API token from the *Edit Cloudflare Workers* template, limited to your account and the zone of your domain.
2. Add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. In `wrangler.jsonc`, set `name` and replace the `routes` pattern with a hostname in a Cloudflare zone you control, or remove `routes` to use only the `workers.dev` address.

## Switching images off

Set the repository variable `SHOW_HEADSHOTS` or `SHOW_LOGOS` to `false` and run the Publish workflow. The next bundle tells the app not to request those images; no code change or rebuild of the app is involved. Cards fall back to jersey numbers, positions and team colors.

## Off-season

Outside the regular season the export writes a manifest with no week, and the page says the season is over while keeping the visitor's saved lineup. The scheduled job keeps succeeding; disable the Publish workflow if you would rather not run it. GitHub pauses scheduled workflows after 60 days without repository activity, so re-enable it from the Actions tab before the season starts.

## The www redirect

`infra/www-redirect` is a separate five-line Worker that redirects `www.ffwatchlist.com` to the bare domain, so a saved lineup lives under one origin. It changes rarely and is deployed by hand with `npx wrangler deploy --cwd infra/www-redirect`.

## By hand

```sh
npm run build
uv run ff-watchlist export
npx wrangler deploy
```
