# Experiment Protocol

The app implements a blinded, counterbalanced validation protocol comparing
**Random Shuffle** against **Vibe Shuffle**.

## Design

- **Pool**: a fixed set of 100 curated Spotify tracks (`src/demoTracks.js`), 25
  per valence/arousal quadrant. Every participant hears from the same pool.
- **Blocks**: each block is `random` or `vibe` and holds 5 tracks.
- **Protocol (between-subjects)**: each participant runs the loop **once**, in
  **one fixed order** — **2 blocks, 10 tracks total**. The order is one of two
  masked protocols (`buildSessionPlan(protocolKey)` in `src/App.jsx`):
  - **Protokoll 1 = Random→Vibe** (A→B)
  - **Protokoll 2 = Vibe→Random** (B→A)

  Counterbalancing is **across participants**: roughly half get each protocol.
- **Participant number**: entered at setup. It pre-selects the suggested protocol
  (odd number → Protokoll 1, even number → Protokoll 2), which the experimenter
  can override via the masked toggle. The session is also tagged with
  `protocol_id` (`VS-<timestamp>`).
- **Listening window**: each track plays for **60 seconds**, then the rating
  prompt opens. The participant can also rate early ("Rate now").
- **Blinding**: the condition (random vs vibe) is never shown to the participant.
  The order is presented only as a **masked label** — "Protokoll 1" / "Protokoll
  2" — so the participant cannot tell which condition comes first. The mapping
  above is the **experimenter's key** and lives only in this doc and the CSV, not
  in the participant UI.

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
control bar) and exports a CSV (filename prefixed with `P<number>_`). Columns
(`CSV_COLUMNS` in `src/App.jsx`):

```
protocol_id, participant_number, protocol_label, timestamp, block_order,
run_number, run_order, block_number, block_mode, track_number, song_id,
spotify_id, song_title, artist, song_quadrant, song_valence, song_arousal,
face_present, ecg_connected, physiology_quality, detected_valence,
detected_arousal, physiology_arousal, physiology_coherence,
rating_like_1_to_7, rating_fit_1_to_7
```

`participant_number` and `protocol_label` ("Protokoll 1/2") identify the
participant and the masked condition order; `block_order` is the actual sequence
(e.g. `random>vibe`), from which the A/B order is recoverable for analysis.
`block_number` is the block position (1–2). (`run_number` is always 1 and
`run_order` equals `block_order` now that each participant runs the loop once —
kept for backward compatibility.)
`physiology_arousal` is the active HR/RMSSD z-score arousal estimate;
`physiology_coherence` is exported only as an experimental rhythm/coherence
diagnostic.

Primary analysis (within-participant Vibe-vs-Random contrast, with order
counterbalanced across participants): compare `rating_fit_1_to_7` between
`block_mode = vibe` and `block_mode = random`, controlling for
`rating_like_1_to_7`, block position (`block_number`), and protocol/order when
sample size allows. A mixed model such as
`rating_fit_1_to_7 ~ block_mode + rating_like_1_to_7 + block_number + protocol_label + (1 | participant_number)`
uses each participant's own Random-vs-Vibe contrast while keeping the order
factor visible.
