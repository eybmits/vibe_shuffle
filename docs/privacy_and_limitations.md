# Privacy And Limitations

## Camera Privacy

Expression detection runs locally in the browser. The app does not upload,
store, or export camera frames.

The app uses MediaPipe Face Landmarker blendshapes to estimate expression. This
is not identity recognition and should not be presented as biometric
identification.

## Exported Data

The CSV stores derived experimental data:

- track metadata
- hidden condition label
- detected expression state
- derived Valence/Energy estimates
- expression confidence
- rating

It does not contain images, video, or face landmarks.

## Spotify Limitations

Spotify Audio Features are deprecated and may be blocked for newer apps. The
curated playlist mode avoids this endpoint, but its categories are human-curated
playlist labels rather than measured Valence/Energy features.

Spotify full-track playback requires Spotify Premium and an authenticated user.

## Jamendo Catalog Limitations

The Jamendo catalog path uses real instrumental tracks and keeps license URLs and
download-permission flags. Valence and Energy are inferred from Jamendo
musicinfo tags, speed labels, and waveform peaks. These annotations are
reproducible and useful for the experiment, but they are still heuristic music
emotion labels rather than externally validated ground truth.

## Scientific Limitations

This is an MVP validation dashboard, not a validated affect-recognition system.
The expression classifier only distinguishes `happy` and `sad_low` in the
current prototype. It should be treated as an experimental signal source.

The bundled fallback catalog is useful for demos, but the final study should use
the generated Jamendo catalog or another licensed source aligned with the
experimental design.
