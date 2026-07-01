# Architecture

Vibe Shuffle is a client-only React/Vite single-page app. There is no backend:
all signal processing runs in the browser, and only the ratings are exported as
a CSV file.

## Signal chain

```
camera ──► MediaPipe blendshapes ──► expressionModel ──► continuous valence (+ motion)
heart-rate sensor ──► HR/RR packets ──► physiologyModel ──► arousal (both directions)
                                                  │
                          fuseEmotionSignals ◄─────┘
                                   │
                       valence × arousal  ──►  quadrant (0.5 thresholds)
                                   │
                          rankSongs (Vibe block)
```

- **Valence** comes from the face. `src/expressionModel.js` turns Face
  Landmarker blendshapes into happy/tense/sad scores, subtracts a slowly-learned
  personal neutral baseline, and maps the positive-vs-negative balance to a
  continuous valence (`valenceFromScores`). Head/body motion (nose-tip drift +
  frame differencing) feeds a motion channel that boosts the "happy" score and
  raises arousal.
- **Arousal** comes from the heart-rate sensor when one is connected.
  `src/physiologyModel.js` parses HR + RR intervals, builds a 120 s personal
  baseline, and computes `physiology_arousal` from z-scored HR (up) and RMSSD
  (down), centered on that baseline. HR uses a **median-to-median** comparison
  (window and baseline share the statistic, so a resting state stays centered);
  the RMSSD/SDNN baselines take a **robust median across short chunks**. SDNN is
  logged but excluded from the short-window estimate. A frequency-domain
  `physiology_coherence` diagnostic is exported for later analysis, but it does
  not drive the arousal axis. The live mood dot uses a rolling 8 s HR window for
  fast +bpm/-bpm feedback, while the saved trial physiology summary uses the
  60 s listening window with RMSSD when enough RR intervals are available. A
  single 60 s window is intrinsically noisy (≈ ±0.11), so the saved arousal
  readout is a trend, not a precise instantaneous value.
- **Fusion** (`fuseEmotionSignals`): face sets valence; a usable ECG sets the
  arousal base (both directions); visible movement/head motion adds a strong
  upward arousal boost on top, so dancing can move the energy axis even when
  HRV is near neutral or slightly calm. Without a usable ECG, the face/motion
  channel carries arousal (upward only). With no face and no ECG, both axes
  center at 0.5.
- **Quadrants**: valence × arousal split at 0.5 into Energetic / Calm / Tense /
  Melancholic (internal tags `happy` / `relaxed` / `tense` / `sad_low`).

## Session/protocol

`src/App.jsx` holds the whole flow:

- **Setup screen**: enter the participant number (pre-selects the masked
  protocol, overridable), connect Spotify (playback only), optional camera,
  optional heart-rate sensor; the 100-track pool is always ready.
- **One run of two blocks** (`blockSequence` from `buildSessionPlan(protocolKey)`):
  one `random` + one `vibe` block in a fixed, participant-specific order — either
  Random→Vibe (Protokoll 1) or Vibe→Random (Protokoll 2), 5 tracks per block,
  60 s each → **10 tracks total**. Counterbalancing is **between participants**
  (each runs one order). `random` ranks tracks deterministically at random,
  `vibe` ranks by distance to the mean fused valence/arousal position sampled
  across the full 60 s listening window (`rankSongs`). The saved trial row
  exports that same full-window detected valence/arousal plus the 60 s
  physiology summary.
- **Rating**: after each track, two sequential 7-point questions (liking, then
  mood-fit) collected in `RatingModal` and saved by `submitRating`.
- **Result**: `ResultsChart` shows mean mood-fit Vibe vs Random (liking as a
  control); `downloadCsv` exports the slim `CSV_COLUMNS`.

## Playback

`useSpotifyAuth` (Authorization Code + PKCE, playback scopes only) and
`useSpotifyPlayer` (Web Playback SDK) drive playback. `startPlayback` issues a
single `PUT /me/player/play` and only starts the listening-window timer once
Spotify accepts the track.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/App.jsx` | UI, hooks (auth/player/camera/HR), protocol, rating, chart, CSV. |
| `src/expressionModel.js` | Expression → continuous valence, baseline, motion. |
| `src/physiologyModel.js` | HR/HRV, baseline, arousal, signal fusion. |
| `src/spotifyLibrary.js` | Quadrant definitions + `buildDemoLibrary()`. |
| `src/demoTracks.js` | The 100 curated tracks with embedded features. |
