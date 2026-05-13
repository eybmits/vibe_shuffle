# vibe_shuffle

One-page React + Tailwind dashboard for the Vibe Shuffle experiment.

Vibe Shuffle compares random song selection against mood-adaptive song
selection based on simulated heart rate and HRV. The dashboard now runs a
fixed validation protocol: Random Shuffle first, then Vibe Shuffle. Users rate
each song on a 1-4 Likert scale before moving to the next song, and the results
can be exported as a CSV file.

The emotional state is derived from two axes:

- Valence: low to high
- Energy: low to high

These axes map to four emotions:

- Calm: high valence, low energy
- Energetic: high valence, high energy
- Stressed: low valence, high energy
- Melancholic: low valence, low energy

## Run

```bash
npm install --cache ./.npm-cache
npm run dev
```

Open http://localhost:5173.

## Build

```bash
npm run build
```

## Deploy

Live site:

https://eybmits.github.io/vibe_shuffle_site/

The source repository stays private. GitHub Pages is served from the separate
public static repository `eybmits/vibe_shuffle_site`, which contains the built
`dist/` output.
