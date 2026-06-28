# VibeTracker

VibeTracker is a single-page React app for a blinded music-recommendation
validation study. It compares a passive **Random Shuffle** block against a
mood-adaptive **Vibe Shuffle** block, while estimating the participant's
affective state locally in the browser (facial expression + optional heart-rate
sensor) and logging two ratings per track.

Live demo: https://eybmits.github.io/vibe-tracker-pages/

## What it does

- Plays a **fixed curated pool of 100 well-known Spotify tracks** (25 per
  valence/arousal quadrant) via the Spotify Web Playback SDK. No personal
  library is read — Spotify is used **only for playback**.
- Runs a **between-subjects counterbalanced protocol**: every participant gets
  one masked order — Random→Vibe or Vibe→Random — for **10 tracks** (two blocks
  × 5 tracks, 60 seconds each). The participant number pre-selects the suggested
  protocol, and the experimenter can override it. No account is needed: one
  complete 10-track session = one participant (`protocol_id`).
- Estimates the participant's state locally:
  - **Camera → valence.** MediaPipe Face Landmarker blendshapes are mapped to a
    *continuous* valence with a personal neutral baseline (small deviations from
    an individual resting face count; a clear smile approaches 0.95, a clearly
    negative face approaches 0.10).
  - **Heart-rate sensor → arousal.** An optional Web Bluetooth ECG/HR sensor
    drives arousal **both up and down** (HR↑ / RMSSD↓ → higher arousal) against
    a 120 s personal baseline.
  - **Body/head motion → arousal boost.** Movement in the camera (nodding,
    swaying) adds to arousal on top of the ECG. Without an ECG it carries
    arousal alone (upward only).
  - **Fusion:** face = valence axis, ECG = arousal base (both directions),
    motion adds on top. State maps to one of four quadrants
    (Energetic / Calm / Tense / Melancholic) at the 0.5 thresholds.
- The **Vibe** block ranks the next track by distance to the measured state in
  the valence/arousal plane; the **Random** block picks deterministically at
  random. Both draw from the same 100-track pool.
- After each track, **two sequential 7-point ratings**: (1) how much you like
  the song, (2) how well it fit your current mood. Separating liking from
  mood-fit lets the analysis check whether a low fit is just low liking.
- At the end: a **results chart** (mean mood-fit Vibe vs Random, with liking as
  a control) and a **CSV export** with only the validation-relevant columns.
- All camera and heart-rate processing stays in the browser. Only the ratings
  (and the derived state values) are exported.

## Stack

- React 19 + Vite, Tailwind CSS.
- `@mediapipe/tasks-vision` Face Landmarker (loaded from CDN at runtime).
- Spotify Web Playback SDK (loaded at runtime) for playback.
- Web Bluetooth (`heart_rate` GATT service) for the optional sensor.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/App.jsx` | App shell: setup screen, session/protocol, playback, rating modal, results chart, CSV export, Spotify auth + player + camera + HR hooks. |
| `src/expressionModel.js` | Facial-expression model: blendshapes → scores → continuous valence, personal baseline, head-motion channel. |
| `src/physiologyModel.js` | HR/HRV parsing, baseline, arousal estimate, and `fuseEmotionSignals` (face + ECG + motion). |
| `src/spotifyLibrary.js` | `EMOTION_QUADRANTS`, `quadrantFromAxes`, and `buildDemoLibrary()`. |
| `src/demoTracks.js` | The 100 curated tracks (real Spotify IDs + embedded valence/energy). |
| `src/*.test.js` | Node test suites for the expression and physiology models. |
| `docs/` | Architecture, experiment protocol, Spotify setup, deployment, privacy, troubleshooting. |

The demo set in `src/demoTracks.js` was generated once from the public Kaggle
"Spotify Tracks Dataset" (real Spotify audio features, ~2022): the 25 most
popular tracks per quadrant with their valence/energy baked in. It is a static
data module — no build step is required at runtime.

## Setup

A Spotify app (Client ID) is required for playback. See
[docs/spotify_setup.md](docs/spotify_setup.md). In short:

1. Create an app at https://developer.spotify.com/dashboard and enable **Web API**
   and **Web Playback SDK**.
2. Add the redirect URI(s): the deployed site URL and `http://localhost:5173/`
   for local dev.
3. The app is in **Development mode**, so every Spotify account that signs in
   must be added under **User Management** (max. 5) and must have **Spotify
   Premium**.

Create a `.env` (git-ignored) with the Client ID:

```bash
VITE_SPOTIFY_CLIENT_ID=your_client_id
# optional, defaults to the current origin+path:
# VITE_SPOTIFY_REDIRECT_URI=http://localhost:5173/
```

## Develop, test, build

```bash
npm install
npm run dev      # local dev server (Vite)
npm test         # expression + physiology model test suites
npm run build    # production build to dist/
npm run preview  # serve the production build
```

## Running a session

1. **Connect Spotify** (Premium + allowlisted account). The web player must
   report ready.
2. **Camera** (optional) and **heart-rate sensor** (optional; a "Demo" sensor
   is available for testing) can be enabled.
3. **Begin session.** Each track plays for 60 s, then the two ratings appear.
4. After all 10 tracks the result chart is shown and the CSV is offered.

## CSV columns

The export is intentionally slim (`CSV_COLUMNS` in `src/App.jsx`):

```
protocol_id, timestamp, block_order, run_number, run_order, block_number,
block_mode, track_number, song_id, spotify_id, song_title, artist,
song_quadrant, song_valence, song_arousal, face_present, ecg_connected,
physiology_quality, detected_valence, detected_arousal, physiology_arousal,
physiology_coherence, rating_like_1_to_7, rating_fit_1_to_7
```

`block_mode` is `random` or `vibe`. `block_order` is the full two-block session
sequence (e.g. `random>vibe`); `run_number` is always 1 and `run_order` equals
`block_order`, retained for backward-compatible exports. `detected_valence`/
`detected_arousal` are the fused state at rating time. `physiology_arousal` is
the baseline-relative HR/RMSSD z-score estimate; `physiology_coherence` is logged
as an experimental diagnostic and is not used for track selection.

## Deployment

The build in `dist/` is published to a separate GitHub Pages repo. See
[docs/deployment.md](docs/deployment.md).

## License

MIT — see [LICENSE](LICENSE).
