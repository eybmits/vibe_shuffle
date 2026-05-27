# Privacy And Limitations

## Camera Privacy

Expression detection runs locally in the browser. The app does not upload,
store, or export camera frames.

The app uses [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
blendshapes to estimate expression. This is not identity recognition and should
not be presented as biometric identification, clinical affect diagnosis, or
validated microexpression detection.

## Exported Data

The CSV stores derived experimental data:

- track metadata
- hidden condition label
- detected expression state
- derived Valence/Arousal estimates
- expression confidence
- window-average expression scores
- optional ECG/HRV summary metrics and baseline-normalized arousal
- rating

It does not contain images, video, face landmarks, raw ECG waveforms, or raw
camera frames.

## Expression API Scope

The current implementation stays local-only: camera frames do not leave the
browser. Cloud emotion APIs such as
[AWS Rekognition](https://docs.aws.amazon.com/rekognition/latest/dg/faces.html)
are therefore out of scope because they require sending images or frames to an
external service.

[Hume Expression Measurement](https://dev.hume.ai/docs/expression-measurement/overview)
is also not used for this prototype because its legacy API is being sunset, with
the last listed API-use/download date on June 14, 2026. The project keeps
MediaPipe Face Landmarker as the defensible browser-local signal source.

## Spotify Limitations

Spotify Audio Features are deprecated and may be blocked for newer apps. The
curated playlist mode avoids this endpoint, but its categories are human-curated
playlist labels rather than measured Valence/Arousal features.

Spotify full-track playback requires Spotify Premium and an authenticated user.

## ECG / HRV Limitations

The ECG/heart-rate path uses the browser's Web Bluetooth access to the standard
[Bluetooth Heart Rate Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HRS_v1.0/out/en/index-en.html).
HRV requires RR intervals in the Heart Rate Measurement packets. Devices that
only expose bpm are displayed and logged, but they are not used for HRV-based
track selection.

The physiology model uses personal baseline deviations. Higher HR with lower
RMSSD/SDNN is treated as higher arousal, but HR/HRV is not used as a standalone
emotion classifier. Recent Nature-family work supports physiology as useful for
emotion recognition while also favoring multimodal signals, so this app uses
face expression for Valence and ECG/HRV for Arousal.

Relevant references:

- [Scientific Reports 2026: IoT-based emotion recognition using internal body parameters](https://www.nature.com/articles/s41598-026-35982-9)
- [npj Flexible Electronics 2026: smart hoodie for emotion recognition and regulation](https://www.nature.com/articles/s41528-026-00585-x)

## Jamendo Catalog Limitations

The Jamendo catalog path uses real instrumental tracks and keeps license URLs and
download-permission flags. Valence and Arousal are inferred from Jamendo
musicinfo tags, speed labels, and waveform peaks. These annotations are
reproducible and useful for the experiment, but they are still heuristic music
emotion labels rather than externally validated ground truth.

## Scientific Limitations

This is an MVP validation dashboard, not a validated affect-recognition system.
The expression classifier estimates `happy`, `relaxed`, `tense`, and `sad_low`.
The ECG/HRV arousal estimate should also be treated as an experimental signal
source.

The bundled fallback catalog is useful for demos, but the final study should use
the generated Jamendo catalog or another licensed source aligned with the
experimental design.
