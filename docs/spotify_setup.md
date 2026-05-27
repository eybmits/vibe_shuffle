# Spotify Setup

Spotify is used in two separate ways:

- Build-time catalog generation.
- Runtime browser playback.

These require different credentials and limitations.

For the real 100-track instrumental catalog, prefer
[`music_catalog.md`](music_catalog.md). Spotify should not be used as a download
source for audio files.

## Required Developer App

Create a Spotify Developer app and configure redirect URIs for local and
deployed use. Keep client secrets out of the repo.

Useful local variables:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
VITE_SPOTIFY_CLIENT_ID=...
VITE_SPOTIFY_REDIRECT_URI=http://localhost:5173/
```

## Curated Playlist Mode

Recommended mode for this repository. It avoids Spotify Audio Features.

```bash
SPOTIFY_CATALOG_MODE=curated
SPOTIFY_HAPPY_PLAYLIST_URL=https://open.spotify.com/playlist/...
SPOTIFY_SAD_PLAYLIST_URL=https://open.spotify.com/playlist/...
npm run spotify:catalog
```

Optional:

```bash
SPOTIFY_RELAXED_PLAYLIST_URL=https://open.spotify.com/playlist/...
SPOTIFY_TENSE_PLAYLIST_URL=https://open.spotify.com/playlist/...
```

In this mode, Spotify supplies metadata and playback identifiers. The category
is assigned by the source playlist:

- Happy playlist -> `happy`
- Sad playlist -> `sad_low`
- Relaxed playlist -> `relaxed`
- Tense playlist -> `tense`

The resulting Valence/Arousal values are category estimates, not Spotify Audio
Features.

## Audio Features Mode

This mode uses Spotify Audio Features if the app still has access:

```bash
SPOTIFY_CATALOG_MODE=features
SPOTIFY_PLAYLIST_URL=https://open.spotify.com/playlist/...
npm run spotify:catalog
```

The script queries Spotify's Valence and `energy` audio-feature fields,
instrumentalness, speechiness, danceability, and tempo. In the app UI, `energy`
is presented as Arousal. It filters for instrumental character:

- `instrumentalness >= 0.5`
- `speechiness <= 0.33`

Spotify has deprecated and restricted Audio Features for some newer apps. If the
endpoint returns `403`, use curated mode.

## Runtime Playback

Full-track browser playback uses Spotify Authorization Code with PKCE and the
Spotify Web Playback SDK. It requires:

- `VITE_SPOTIFY_CLIENT_ID`
- a registered redirect URI
- Spotify Premium for the logged-in user

Without Spotify setup, the app remains usable with the real instrumental
fallback catalog.
