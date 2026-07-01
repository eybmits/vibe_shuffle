# Deployment

The project uses one repository:

- Source repository: `eybmits/vibe-shuffle`
- GitHub Pages deployment: GitHub Actions workflow from `main`

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

Deployment is automatic on every push to `main` via
`.github/workflows/pages.yml`. To run the same checks locally:

```bash
npm run build
```

To redeploy without a code change, open the `Deploy GitHub Pages` workflow in
GitHub Actions and run it manually with `workflow_dispatch`.

## Verification

```bash
curl -I -L https://eybmits.github.io/vibe-shuffle/
```

Expected result: `HTTP/2 200`.

If GitHub Pages still shows the previous build, wait for cache propagation or
hard-refresh the browser.
