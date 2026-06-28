# Privacy and limitations

## Camera privacy

Expression detection runs **locally in the browser**. The app does not upload,
store, or export camera frames or face landmarks.

It uses [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
blendshapes to estimate expression. This is **not** identity recognition,
clinical affect diagnosis, or validated microexpression detection.

The face model learns a **personal neutral baseline** (a slow running average of
the resting face) and reports *deviations* from it, so an individually "strict"
resting face still reads as neutral. The positive-vs-negative balance maps to a
continuous valence. Face cues drive the **valence** axis only.

## Heart-rate / arousal

The optional sensor uses Web Bluetooth and the standard
[Bluetooth Heart Rate Service](https://www.bluetooth.com/specifications/specs/heart-rate-service-1-0/).
HRV needs RR intervals in the packets; devices that expose only bpm are logged
but not used for HRV. Arousal is computed from baseline-normalized HR (up) and
RMSSD (down) over a 120 s personal baseline, and can move **both** above and
below neutral. Head/body motion adds to arousal on top of the ECG. HR/HRV is an
experimental arousal signal, not a standalone emotion classifier, and the weights
are pilot values, not validated clinical coefficients.

A separate frequency-domain `physiology_coherence` value is exported as an
experimental diagnostic of rhythmic regularity. It is not mapped onto the
arousal axis because coherence is not the same construct as baseline-relative
autonomic activation.

The HR comparison is **median-to-median** — the live window and the baseline use
the same statistic, so a steady (baseline-equal) state sits at the neutral
midpoint instead of drifting up (a window-mean vs. baseline-median comparison
would bias arousal upward, because `1/RR` is right-skewed). The RMSSD/SDNN
baselines take a **robust median across short chunks** so a brief artifact during
calibration corrupts only one chunk. Note that a single 60 s window is
**inherently noisy** (≈ ±0.11 on the 0–1 arousal scale): individual readings
scatter around the midpoint without signalling a real change, so arousal is
meaningful as a **trend**, not as one instantaneous value.

## Signal-fusion rationale

Face = valence, ECG = arousal (both directions), motion = additive arousal
boost. Autonomic signals (HR/HRV) track arousal well but cannot separate
positive from negative valence; facial expression is the more direct valence
signal. Without a usable ECG, the camera/motion channel carries arousal but can
only raise it (stillness is ambiguous), so the lower half of the arousal axis is
reliably reachable only with a sensor.

## Exported data

The CSV contains only derived experimental data (`CSV_COLUMNS` in
`src/App.jsx`): protocol/track metadata, the (hidden) block condition, the fused
valence/arousal at rating time, optional physiology summary fields, and the two
ratings. It contains **no** images, video, face landmarks, or raw ECG waveforms.

## Spotify limitations

- Spotify **Audio Features** are deprecated/restricted for newer apps, so the
  app does not call them at runtime — the curated tracks carry features from a
  ~2022 dataset (see [`music_catalog.md`](music_catalog.md)). Tracks released
  after that dataset are therefore not in the pool.
- Full-track playback requires **Spotify Premium** and an allowlisted account
  (Development mode); see [`spotify_setup.md`](spotify_setup.md).

## Scientific limitations

This is an MVP validation dashboard, not a validated affect-recognition system.
The valence/arousal estimates and the quadrant labels (Energetic / Calm / Tense
/ Melancholic) should be treated as experimental signals. The fixed 100-track
pool keeps the Vibe-vs-Random comparison controlled but is not a personalized or
exhaustive music selection.
