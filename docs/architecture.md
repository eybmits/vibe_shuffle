# Architecture

Vibe Shuffle is a Vite + React + Tailwind single-page app. The application is
client-only; there is no backend service.

## Main Components

- `src/App.jsx`: complete experiment UI, state machine, playback handling,
  expression sampling, track ranking, rating modal, and CSV export.
- `src/expressionModel.js`: pure local expression scoring, temporal switching,
  and listening-window summaries.
- `src/physiologyModel.js`: pure BLE heart-rate parsing, RR filtering, HRV
  metrics, baseline normalization, and face/ECG fusion.
- `src/data/musicCatalog.json`: static track catalog consumed by the app.
- `src/data/spotifyCatalog.json`: legacy/optional Spotify catalog output.
- `scripts/build_kaggle_spotify_youtube_catalog.mjs`: current public-demo
  generator using the Kaggle Spotify Tracks Dataset mirror plus direct YouTube
  video lookup.
- `scripts/build_curated_instrumental_catalog.mjs`: current public-demo
  fallback generator using Wikimedia Commons/Incompetech and selected Internet
  Archive instrumentals.
- `scripts/build_jamendo_catalog.mjs`: preferred real-music catalog generator.
- `scripts/build_internet_archive_catalog.mjs`: no-login real-music fallback
  generator.
- `scripts/build_spotify_catalog.mjs`: build-time Spotify catalog generator.
- `src/index.css`: Tailwind entrypoint and global base styles.

## Data Flow

1. The app loads `musicCatalog.json`.
2. Each track is normalized into a common internal shape:
   `id`, `title`, `artist`, `spotifyUri`, `audioUrl`, `quadrant`,
   `valence`, `energy`, `instrumentalness`, and visual styling fields. The
   user-facing label for `energy` is Arousal.
3. The participant selects preferred instrumental genres in a music taste
   baseline screen.
4. The validation protocol starts with Random Shuffle and then a hidden
   genre-constrained Vibe block.
5. Expression samples are estimated locally with MediaPipe Face Landmarker
   blendshapes.
6. Optional ECG/heart-rate samples are read locally through Web Bluetooth Heart
   Rate Service notifications.
7. Both blocks use the same participant-selected genre pool as the candidate
   set.
8. At the end of each listening window, the app averages expression samples and
   summarizes HR/HRV samples from that window.
9. Random Shuffle ranks that shared genre pool randomly. The hidden Vibe block
   ranks the same pool by fused face Valence plus ECG/HRV arousal when
   physiology quality is good; otherwise it falls back to face-only window
   selection.
10. After each listening window, the participant must submit a 1-4 rating.
11. At protocol completion, ratings are exported as CSV.

## Expression Detection

The browser loads MediaPipe Face Landmarker from `@mediapipe/tasks-vision`.
The app uses face blendshape scores, not identity recognition. The expression
model estimates:

- `happy`
- `relaxed`
- `tense`
- `sad_low`

The classifier does not use a personal face baseline. It uses absolute
blendshape cues, exponential smoothing, minimum sustained samples, and switching
margins to reduce flicker. Neutral/low-evidence faces default to `relaxed`.
Smile evidence increases the Valence coordinate, while frown/downturned-mouth
or facial-tension evidence lowers Valence. The face model does not move the
Arousal coordinate. If no face is detected, the Valence/Arousal point is held at
the center of the map. `sad_low` requires sustained frown/downturned-mouth
evidence plus low smile evidence. Camera frames are not stored or uploaded.

Track selection uses the average expression scores across the just-finished
listening window, not the last detected instant. This makes brief end-of-song
noise less likely to control the next Vibe Shuffle track.

## ECG / HRV Signal

The browser can connect to standard Bluetooth Heart Rate Service devices and
parse Heart Rate Measurement packets. HRV requires RR intervals; bpm-only
devices are logged as `bpm_only` and do not drive selection. RR intervals are
filtered to `300-2000 ms`, implausible jumps are rejected as artifacts, and the
app computes mean HR, mean RR, RMSSD, SDNN, pNN20, RR count, and artifact rate.

After connection, the app runs a neutral 60 second physiology baseline and
stores only session-local baseline statistics. In Vibe Shuffle, ECG/HRV provides
the Arousal coordinate when quality is good, while the face-expression window
provides the Valence coordinate. Without good ECG/HRV, Arousal remains centered
instead of being inferred from the face. This follows the project constraint
that HR/HRV should not be treated as a standalone emotion classifier. The pilot
Arousal formula uses equal weights for normalized HR rise, RMSSD drop, and SDNN
drop.

## Playback Paths

There are three playback paths:

- YouTube embedded playback: the current Kaggle/Spotify catalog stores a
  resolved YouTube video id and embed URL for each track. The visible player
  iframe is controlled by the same `Start music` / `Pause` button.
- Direct MP3/stream playback: Jamendo or fallback instrumental URLs in the
  catalog.
- Spotify Web Playback SDK: full-track playback for Spotify catalog entries
  with `spotifyUri`; requires Spotify Premium.
- Spotify preview URL: stored when available during catalog generation, but not
  relied on for full-track playback.

## Catalog Generation

Catalog generators run at build time, not in the browser. The current public
path writes `src/data/musicCatalog.json` and
`data/kaggle_spotify_youtube_catalog.csv`. It uses the Spotify Tracks Dataset
mirror, filters for high instrumental character, classifies quadrants from
Valence and `energy`, and resolves one YouTube embed per track. Jamendo,
Internet Archive, curated fallback, and Spotify paths can also write
`src/data/musicCatalog.json`. Secrets are provided through environment
variables or an ignored `.env` file and are never committed.
