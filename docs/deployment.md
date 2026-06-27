# Deployment

The project uses two repositories:

- Source repository: `eybmits/vibe-tracker`
- Static GitHub Pages repository: `eybmits/vibe-tracker-pages`

Live site:

https://eybmits.github.io/vibe-tracker-pages/

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
rm -rf /tmp/vibe-tracker-pages-deploy
git clone https://github.com/eybmits/vibe-tracker-pages.git /tmp/vibe-tracker-pages-deploy
find /tmp/vibe-tracker-pages-deploy -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R dist/. /tmp/vibe-tracker-pages-deploy/
cd /tmp/vibe-tracker-pages-deploy
touch .nojekyll
git add -A
git commit -m "Deploy Vibe Shuffle update"
git push origin main
```

## Verification

```bash
curl -I -L https://eybmits.github.io/vibe-tracker-pages/
```

Expected result: `HTTP/2 200`.

If GitHub Pages still shows the previous build, wait for cache propagation or
hard-refresh the browser.
