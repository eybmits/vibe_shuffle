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
but not used for HRV. Arousal is computed from baseline-normalized HR as the
primary signal, with RMSSD as secondary evidence (lower RMSSD can raise
arousal, higher RMSSD can lower it). The live mood dot uses a short
baseline-relative HR window for fast feedback while the RR/RMSSD window is still
building. Short-window RMSSD is damped when it conflicts with a calm/low-HR
signal, and the estimate can move **both** above and below neutral. Head/body
motion adds to arousal on top of the ECG. HR/HRV is an experimental arousal
signal, not a standalone emotion classifier, and the weights are pilot values,
not validated clinical coefficients.

No population/global RMSSD threshold is used for arousal. The live HR/RMSSD
window is compared only with the participant's own calibration baseline from
that session. If a real BLE sensor does not provide enough usable RR intervals
for that personal baseline, HRV arousal stays disabled instead of substituting a
mock or global reference.

The live mood-sector feedback uses a rolling **8 s** HR window so +bpm/-bpm
changes move the y-axis quickly. The saved trial physiology summary uses a
rolling **60 s** HR/RMSSD window, matched to the listening trial length. The
Vibe block's next-song choice uses the mean fused mood-space position sampled
across that same 60 s listening window, so one brief spike does not fully define
the next song but sustained movement away from baseline does. The diagnostic
heart-rate chart is plotted as **bpm vs rest**, so the personal baseline is the
`0` line.

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
boost. Strong visible movement (dancing, swaying, repeated head motion) can move
the energy axis upward even when HRV is near neutral or slightly calm. Autonomic
signals (HR/HRV) track arousal well but cannot separate positive from negative
valence; facial expression is the more direct valence signal. Without a usable
ECG, the camera/motion channel carries arousal but can only raise it (stillness
is ambiguous), so the lower half of the arousal axis is reliably reachable only
with a sensor.

## Exported data

The CSV contains only derived experimental data (`CSV_COLUMNS` in
`src/App.jsx`): protocol/track metadata, the (hidden) block condition, the fused
valence/arousal summary, optional physiology summary fields, the two ratings,
and the participant's categorical mood self-report. It contains **no** images,
video, face landmarks, or raw ECG waveforms.

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
