# Vibe Shuffle

Vibe Shuffle is a one-page React dashboard for a blinded music-recommendation
validation study. It compares a passive Random Shuffle block against a
mood-adaptive Vibe Shuffle block. The current prototype estimates the
participant's expression locally in the browser, maps it to `happy`, `relaxed`,
`tense`, or `sad_low`, and selects the next adaptive track from the averaged
expression state plus optional ECG/HRV arousal over the just-finished listening
window.

Live demo:

https://eybmits.github.io/vibe_shuffle_site/

## What It Does

- Runs a fixed validation protocol: Random Shuffle first, then Vibe Shuffle.
- Keeps the condition hidden from the participant.
- Plays real instrumental fallback tracks immediately, without external setup.
- Supports a legal 100-track Jamendo catalog with downloadable instrumental audio.
- Keeps Spotify as an optional metadata/playback path, not as the download source.
- Uses local MediaPipe Face Landmarker blendshapes for expression detection.
- Keeps neutral/calm faces in `relaxed` unless there is sustained active
  expression evidence.
- Supports optional Web Bluetooth heart-rate sensors. RR intervals enable HRV;
  bpm-only devices are logged but not used for HRV-based selection.
- Requires a 1-4 mood-fit rating after every track.
- Exports session ratings as a CSV file.

## Current Prototype Status

The deployed app is ready for coauthor review as an MVP demo. It currently uses
the bundled real instrumental fallback catalog. The preferred final catalog path
is Jamendo: the script collects up to 100 real instrumental tracks, keeps
license/download metadata, estimates Valence/Arousal from Jamendo music metadata
and waveform peaks, and writes the static catalog used by the app.

The camera detector is expression detection, not identity recognition. Optional
ECG/HRV is used as an arousal signal, not as a standalone emotion classifier.
Camera frames and physiology streams stay in the browser and are not uploaded.

## Quick Start

```bash
npm install --cache ./.npm-cache
npm run dev
```

Open http://localhost:5173.

## Build

```bash
npm run build
```

Optional checks:

```bash
npm audit --omit=dev
npm test
npm run check:catalog-script
```

## Optional ECG / HRV Input

The browser app can connect to standard Bluetooth Heart Rate Service devices,
for example chest straps that expose RR intervals. After connection, the app
runs a neutral 60 second baseline before using HRV. Vibe Shuffle then fuses
face-expression Valence with HR/HRV-derived Arousal for adaptive track
selection. The `Demo` sensor button provides a local mock ECG stream for browser
testing without hardware.

## Real 100-Track Music Catalog

The app reads a static catalog from `src/data/musicCatalog.json`.

Current public-demo path:

```bash
npm run curated:catalog
```

This builds a curated legal instrumental catalog from Wikimedia
Commons/Incompetech and selected Internet Archive instrumentals. It writes
`src/data/musicCatalog.json` and `data/curated_instrumental_catalog.csv`.

Jamendo path for future larger catalog experiments:

```bash
JAMENDO_CLIENT_ID="..." npm run jamendo:catalog
```

The Jamendo script:

- filters for `vocalinstrumental=instrumental`,
- keeps only tracks with playable audio and cover art,
- by default requires `audiodownload_allowed=true`,
- estimates `valence` and arousal from Jamendo mood tags, speed labels, and
  waveform peaks. The static catalog field is still named `energy` for
  compatibility with imported music metadata,
- assigns one of `happy`, `relaxed`, `tense`, or `sad_low`,
- writes `src/data/musicCatalog.json` and `data/jamendo_catalog.csv`.

Optional local audio audit:

```bash
JAMENDO_CLIENT_ID="..." \
JAMENDO_DOWNLOAD_AUDIO=true \
npm run jamendo:catalog
```

Downloaded MP3 files are saved under `data/audio/jamendo/` and ignored by git.

No-login broad fallback:

```bash
npm run archive:catalog
```

This uses the Internet Archive advanced search and metadata APIs to collect
licensed instrumental MP3 files from the `netlabels` collection without any API key. It writes
`src/data/musicCatalog.json` and `data/internet_archive_catalog.csv`.

## Spotify Catalog Modes

Spotify remains useful for browser playback and metadata, but Spotify content
must not be downloaded. The Spotify importer writes both
`src/data/spotifyCatalog.json` and `src/data/musicCatalog.json`.

### Curated Playlist Mode

Use this mode when Spotify Audio Features are unavailable. Spotify provides
metadata, cover art, track URIs, and playback identifiers; the category comes
from the playlist you choose.

```bash
SPOTIFY_CLIENT_ID="..." \
SPOTIFY_CLIENT_SECRET="..." \
SPOTIFY_CATALOG_MODE="curated" \
SPOTIFY_HAPPY_PLAYLIST_URL="https://open.spotify.com/playlist/..." \
SPOTIFY_SAD_PLAYLIST_URL="https://open.spotify.com/playlist/..." \
npm run spotify:catalog
```

Optional four-quadrant curated inputs:

```bash
SPOTIFY_RELAXED_PLAYLIST_URL="https://open.spotify.com/playlist/..."
SPOTIFY_TENSE_PLAYLIST_URL="https://open.spotify.com/playlist/..."
```

### Audio Features Mode

Use this mode only if the Spotify app still has access to the deprecated Audio
Features endpoint.

```bash
SPOTIFY_CLIENT_ID="..." \
SPOTIFY_CLIENT_SECRET="..." \
SPOTIFY_CATALOG_MODE="features" \
SPOTIFY_PLAYLIST_URL="https://open.spotify.com/playlist/..." \
npm run spotify:catalog
```

The generated files are:

- `src/data/spotifyCatalog.json`
- `data/spotify_catalog.csv`

## Runtime Spotify Playback

Full Spotify playback in the browser uses Authorization Code with PKCE and the
Spotify Web Playback SDK. It requires a Spotify Premium account.

```bash
VITE_SPOTIFY_CLIENT_ID="..."
VITE_SPOTIFY_REDIRECT_URI="http://localhost:5173/"
```

The redirect URI must also be registered in the Spotify Developer Dashboard.

## Documentation

- [Architecture](docs/architecture.md)
- [Experiment protocol](docs/experiment_protocol.md)
- [Real music catalog](docs/music_catalog.md)
- [Spotify setup](docs/spotify_setup.md)
- [Deployment](docs/deployment.md)
- [Privacy and limitations](docs/privacy_and_limitations.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

MIT. See [LICENSE](LICENSE).
