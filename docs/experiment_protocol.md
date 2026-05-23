# Experiment Protocol

The app implements a fixed blinded validation protocol for comparing Random
Shuffle against Vibe Shuffle.

## Session Structure

- Block 1: Random Shuffle.
- Block 2: Vibe Shuffle.
- Tracks per block: 5.
- Listening window per track: 18 seconds.
- Total ratings per session: 10.

The participant does not see the current block or condition. The UI presents a
neutral listening session and asks for a mood-fit rating after each track.

## Track Selection

Random Shuffle:

- Selects tracks using a deterministic pseudo-random score.
- Does not use expression state for ranking.
- Avoids very recent repeats where possible.

Vibe Shuffle:

- Uses the current expression state.
- Current MVP maps expression to `happy` or `sad_low`.
- Selects from the matching track quadrant when available.
- Falls back to the broader catalog if the matching pool is empty.

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
- track number
- track id, source, Jamendo id, Spotify id, Spotify URI
- title, artist, album
- song quadrant
- song Valence, Energy, instrumentalness, speechiness
- catalog category source, analysis confidence, external URL, license URL
- detected expression label
- detected Valence, Energy, confidence
- whether a face was visible
- rating from 1 to 4

The CSV does not include camera frames, face images, or identity data.
