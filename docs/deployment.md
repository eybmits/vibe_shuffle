# Deployment

The project uses one repository:

- Source repository: `eybmits/vibe-shuffle`
- Static GitHub Pages branch: `gh-pages`

Live site:

https://eybmits.github.io/vibe-shuffle/

## Build

```bash
npm install --cache ./.npm-cache
npm run build
```

The build output is written to `dist/`. The Spotify Client ID is baked in from
`VITE_SPOTIFY_CLIENT_ID` at build time, so build with the `.env` present.

## Deploy To GitHub Pages

From a clean source checkout:

```bash
npm run build
git clone --branch gh-pages --single-branch https://github.com/eybmits/vibe-shuffle.git /tmp/vibe-shuffle-pages
rsync -a --delete --exclude='.git' dist/ /tmp/vibe-shuffle-pages/
cd /tmp/vibe-shuffle-pages
touch .nojekyll
git add -A
git commit -m "Deploy Vibe Shuffle update"
git push origin gh-pages
```

If Pages is configured differently, set it back to the `gh-pages` branch with
root path `/` before deploying.

## Verification

```bash
curl -I -L https://eybmits.github.io/vibe-shuffle/
```

Expected result: `HTTP/2 200`.

If GitHub Pages still shows the previous build, wait for cache propagation or
hard-refresh the browser.
