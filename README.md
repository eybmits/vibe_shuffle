# vibe_shuffle

One-page React + Tailwind dashboard for the Vibe Shuffle experiment.

Vibe Shuffle compares random song selection against mood-adaptive song
selection based on local browser expression detection. The dashboard runs a
fixed blinded validation protocol: the participant never sees whether the
current block is Random Shuffle or Vibe Shuffle. Users rate each song on a
1-4 Likert scale before moving to the next song, and the results can be
exported as a CSV file.

The emotional state is derived from two axes:

- Valence: low to high
- Energy: low to high

The music catalog still uses four Valence x Energy quadrants:

- Happy: high valence, high energy
- Relaxed: high valence, low energy
- Tense: low valence, high energy
- Sad-low: low valence, low energy

## Spotify catalog

The app reads a static catalog from `src/data/spotifyCatalog.json`. The repo
contains a small real instrumental fallback catalog so the UI is immediately
audible before Spotify is configured.

Preferred Spotify-only fallback when Audio Features are unavailable:

```bash
SPOTIFY_CLIENT_ID="..." \
SPOTIFY_CLIENT_SECRET="..." \
SPOTIFY_CATALOG_MODE="curated" \
SPOTIFY_HAPPY_PLAYLIST_URL="https://open.spotify.com/playlist/..." \
SPOTIFY_SAD_PLAYLIST_URL="https://open.spotify.com/playlist/..." \
npm run spotify:catalog
```

In `curated` mode, Spotify provides track metadata and playback URIs, but the
category comes from the source playlist. Tracks from
`SPOTIFY_HAPPY_PLAYLIST_URL` are assigned to `happy`; tracks from
`SPOTIFY_SAD_PLAYLIST_URL` are assigned to `sad_low`. Optional
`SPOTIFY_RELAXED_PLAYLIST_URL` and `SPOTIFY_TENSE_PLAYLIST_URL` can be provided
for four-quadrant catalogs. The script interleaves the configured playlists,
deduplicates tracks, and saves up to 100 tracks without using Audio Features.

Original Audio Features mode:

```bash
SPOTIFY_CLIENT_ID="..." \
SPOTIFY_CLIENT_SECRET="..." \
SPOTIFY_CATALOG_MODE="features" \
SPOTIFY_PLAYLIST_URL="https://open.spotify.com/playlist/..." \
npm run spotify:catalog
```

In `features` mode, the script fetches playlist tracks, queries Spotify Audio
Features, filters for instrumental character (`instrumentalness >= 0.5`,
`speechiness <= 0.33`), maps tracks into the four Valence x Energy quadrants,
and writes:

- `src/data/spotifyCatalog.json`
- `data/spotify_catalog.csv`

Spotify has deprecated and restricted Audio Features for some newer apps. If
Spotify returns `403` for that endpoint, use `curated` mode instead.

## Spotify playback

Real playback uses Spotify Authorization Code with PKCE and the Spotify Web
Playback SDK. Add these Vite environment variables before building the site:

```bash
VITE_SPOTIFY_CLIENT_ID="..."
VITE_SPOTIFY_REDIRECT_URI="http://localhost:5173/"
```

The redirect URI must also be configured in the Spotify Developer Dashboard.
Spotify Premium is required for full-track browser playback. Without a generated
Spotify catalog, the bundled instrumental fallback plays direct MP3 demo tracks.

## Camera signal

Expression detection runs locally in the browser with MediaPipe Face Landmarker
blendshapes. Camera frames are not saved, uploaded, or written to the CSV. The
current MVP reduces the camera signal to a two-class expression state:
`happy` versus `sad_low`. It uses a short per-session baseline calibration,
exponential smoothing, and a switching margin so subtle facial changes are more
stable. In the Vibe Shuffle block, the next song is selected from the matching
Happy or Sad-low pool. The CSV stores only the derived expression state,
Valence/Energy values, confidence, and whether a face was visible.

## Run

```bash
npm install --cache ./.npm-cache
npm run dev
```

Open http://localhost:5173.

## Build

```bash
npm run build
```

## Deploy

Live site:

https://eybmits.github.io/vibe_shuffle_site/

The source repository stays private. GitHub Pages is served from the separate
public static repository `eybmits/vibe_shuffle_site`, which contains the built
`dist/` output.
