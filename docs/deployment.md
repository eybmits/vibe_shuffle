# Deployment

The project uses two repositories:

- Source repository: `eybmits/vibe_shuffle`
- Static GitHub Pages repository: `eybmits/vibe_shuffle_site`

Live site:

https://eybmits.github.io/vibe_shuffle_site/

## Build

```bash
npm install --cache ./.npm-cache
npm run build
```

The build output is written to `dist/`. The Spotify Client ID is baked in from
`VITE_SPOTIFY_CLIENT_ID` at build time, so build with the `.env` present.

## Deploy To GitHub Pages Repo

From a clean source checkout:

```bash
npm run build
rm -rf /tmp/vibe-shuffle-site-deploy
git clone https://github.com/eybmits/vibe-shuffle-site.git /tmp/vibe-shuffle-site-deploy
find /tmp/vibe-shuffle-site-deploy -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R dist/. /tmp/vibe-shuffle-site-deploy/
cd /tmp/vibe-shuffle-site-deploy
touch .nojekyll
git add -A
git commit -m "Deploy Vibe Shuffle update"
git push origin main
```

## Verification

```bash
curl -I -L https://eybmits.github.io/vibe_shuffle_site/
```

Expected result: `HTTP/2 200`.

If GitHub Pages still shows the previous build, wait for cache propagation or
hard-refresh the browser.
