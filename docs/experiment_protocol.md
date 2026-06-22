# Experiment Protocol

The app implements a blinded, counterbalanced validation protocol comparing
**Random Shuffle** against **Vibe Shuffle**.

## Design

- **Pool**: a fixed set of 100 curated Spotify tracks (`src/demoTracks.js`), 25
  per valence/arousal quadrant. Every participant hears from the same pool.
- **Blocks**: each block is `random` or `vibe` and holds 5 tracks.
- **Runs (within-subject counterbalancing)**: every participant goes through the
  loop **twice**. The two runs use **opposite** block orders, so each participant
  experiences **both** Random→Vibe and Vibe→Random — **4 blocks, 20 tracks
  total**. Which order comes first is **randomized per session**
  (`buildSessionPlan` in `src/App.jsx`). A one-time intermission screen separates
  the two runs.
- **No account needed**: one complete 20-track session is one participant,
  identified by the auto-generated `protocol_id` (`VS-<timestamp>`). The A/B
  structure is recorded per trial via `run_number` and `run_order` rather than a
  login.
- **Listening window**: each track plays for **60 seconds**, then the rating
  prompt opens. The participant can also rate early ("Rate now").
- **Blinding**: the condition (random vs vibe) is never shown to the
  participant during the session — including on the intermission screen.

## Selection

- **Random block**: the next track is chosen deterministically at random from
  the pool (a per-session seed makes the order differ every run).
- **Vibe block**: the next track is the one whose (valence, arousal) is closest
  to the participant's fused state over the just-finished window, filtered to
  the matching quadrant when possible, with a penalty for recently played
  tracks.

The participant's state is the fusion of facial valence and (optional)
heart-rate arousal plus head-motion; see `architecture.md`.

## Ratings

After each track, two **7-point** questions are asked **in sequence**:

1. **Liking** — "How much do you like this song?" → `rating_like_1_to_7`
2. **Mood-fit** — "How well did it fit your current mood?" → `rating_fit_1_to_7`

Mood-fit is the primary outcome; liking is the control. Asking both lets the
analysis separate "did not fit my mood" from "I just don't like this song".

## Outcome & export

At the end the app shows mean **mood-fit Vibe vs Random** (with liking as a
control bar) and exports a CSV. Columns (`CSV_COLUMNS` in `src/App.jsx`):

```
protocol_id, timestamp, block_order, run_number, run_order, block_number,
block_mode, track_number, song_id, spotify_id, song_title, artist,
song_quadrant, song_valence, song_arousal, face_present, ecg_connected,
physiology_quality, detected_valence, detected_arousal, physiology_arousal,
rating_like_1_to_7, rating_fit_1_to_7
```

`block_order` is the full session sequence of all four blocks (e.g.
`random>vibe>vibe>random`). `run_number` (1 or 2) and `run_order` (that run's own
order, e.g. `random>vibe`) make the within-subject counterbalancing explicit, and
`block_number` is the global block position (1–4).

Primary analysis: compare `rating_fit_1_to_7` between `block_mode = vibe` and
`block_mode = random`, controlling for `rating_like_1_to_7` and accounting for
order via `run_number` / `run_order`.
