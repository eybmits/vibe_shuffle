# Experiment Protocol

The app implements a fixed blinded validation protocol for comparing Random
Shuffle against Vibe Shuffle.

## Session Structure

- Pre-session: participant selects preferred instrumental genres as a music
  taste baseline.
- Block 1: Random Shuffle.
- Block 2: hidden genre-constrained Vibe Shuffle.
- Tracks per block: 5.
- Listening window per track: 30 seconds by default.
- Total ratings per session: 10.

The participant does not see the current block or condition. The UI presents a
neutral listening session and asks for a mood-fit rating after each track.

## Track Selection

Random Shuffle:

- Uses the same participant-selected genre pool as the adaptive block.
- Selects tracks using a deterministic pseudo-random score.
- Does not use expression state for ranking.
- Avoids very recent repeats where possible.

Hidden genre-constrained Vibe Shuffle:

- Uses the same participant-selected genre pool as Random Shuffle.
- Uses the averaged expression state from the just-finished listening window.
- If ECG/HRV quality is good, fuses face-expression Valence with HR/HRV-derived
  Arousal.
- Maps the fused Valence/Arousal state to `happy`, `relaxed`, `tense`, or
  `sad_low`.
- Selects from the matching track quadrant inside that genre pool when
  available.
- Falls back to the selected genre pool if the matching quadrant is empty.
- Falls back to the broader catalog only if the selected genre pool is empty.

The live camera panel may update during playback, but Vibe track selection is
based on the listening-window average. A brief last-second expression or
physiology spike therefore does not dominate the next song choice.

Participants can use `Jump to rating` to end the current listening window early.
The rating is still mandatory before the next track starts, and the CSV marks
that trial with `jumped_to_rating=true`.

## Rating

After each track, a modal blocks progress until the participant rates:

1. Not a match
2. Slight match
3. Good match
4. Very good match

The next track starts only after a rating is recorded.

## CSV Export

The exported CSV includes:

- protocol/session id
- timestamp
- block number and hidden block mode
- selected genre slugs and labels
- track number
- listening window duration and whether the participant jumped to rating
- track id, source, Jamendo id, Spotify id, Spotify URI
- title, artist, album, genre, popularity
- song quadrant
- song Valence, Arousal, instrumentalness, speechiness
- catalog category source, analysis confidence, external URL, license URL
- YouTube video id, watch URL, and search URL
- detected expression label
- detected Valence, Arousal, confidence
- whether a face was visible
- window-average expression label and confidence
- number of expression samples in the listening window
- mean `happy`, `relaxed`, `tense`, and `sad_low` scores
- ECG connection state and physiology quality
- HR/HRV features: mean HR, RR count, artifact rate, RMSSD, SDNN, pNN20
- baseline HR/RMSSD and normalized HR/RMSSD/SDNN deviations
- physiology arousal plus fused Valence/Arousal
- selection signal source (`window_average` or `face_window_plus_ecg_arousal`)
- rating from 1 to 4

The CSV does not include camera frames, face images, raw ECG waveforms, or
identity data.
