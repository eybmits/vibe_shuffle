# Architecture

Vibe Shuffle is a Vite + React + Tailwind single-page app. The application is
client-only; there is no backend service.

## Main Components

- `src/App.jsx`: complete experiment UI, state machine, playback handling,
  expression detection, track ranking, rating modal, and CSV export.
- `src/data/musicCatalog.json`: static track catalog consumed by the app.
- `src/data/spotifyCatalog.json`: legacy/optional Spotify catalog output.
- `scripts/build_jamendo_catalog.mjs`: preferred real-music catalog generator.
- `scripts/build_internet_archive_catalog.mjs`: no-login real-music fallback
  generator.
- `scripts/build_spotify_catalog.mjs`: build-time Spotify catalog generator.
- `src/index.css`: Tailwind entrypoint and global base styles.

## Data Flow

1. The app loads `musicCatalog.json`.
2. Each track is normalized into a common internal shape:
   `id`, `title`, `artist`, `spotifyUri`, `audioUrl`, `quadrant`,
   `valence`, `energy`, `instrumentalness`, and visual styling fields.
3. The validation protocol starts with Random Shuffle and then Vibe Shuffle.
4. The current expression state is estimated locally with MediaPipe.
5. Random Shuffle ignores expression state for track selection.
6. Vibe Shuffle ranks tracks by the detected expression state and recent-play
   avoidance.
7. After each listening window, the participant must submit a 1-4 rating.
8. At protocol completion, ratings are exported as CSV.

## Expression Detection

The browser loads MediaPipe Face Landmarker from `@mediapipe/tasks-vision`.
The app uses face blendshape scores, not identity recognition. The current MVP
reduces expression to:

- `happy`
- `sad_low`

The classifier uses a short per-session baseline, exponential smoothing, and a
switching margin to reduce flicker. Camera frames are not stored or uploaded.

## Playback Paths

There are three playback paths:

- Direct MP3/stream playback: Jamendo or fallback instrumental URLs in the
  catalog.
- Spotify Web Playback SDK: full-track playback for Spotify catalog entries
  with `spotifyUri`; requires Spotify Premium.
- Spotify preview URL: stored when available during catalog generation, but not
  relied on for full-track playback.

## Catalog Generation

Catalog generators run at build time, not in the browser. The preferred Jamendo
path writes `src/data/musicCatalog.json` and `data/jamendo_catalog.csv`. The
Spotify path writes both `src/data/spotifyCatalog.json` and
`src/data/musicCatalog.json`. Secrets are provided through environment variables
or an ignored `.env` file and are never committed.
