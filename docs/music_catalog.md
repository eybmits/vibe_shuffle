# Real Music Catalog

The current public demo uses a static 100-track catalog generated from the
Kaggle Spotify Tracks Dataset mirror and direct YouTube lookup. The app stores
Spotify metadata and audio-feature fields, but it does not download Spotify
audio. Runtime playback displays the resolved YouTube video directly in the
participant player.

Jamendo remains useful for future larger catalog experiments because it provides
real tracks, stream URLs, download permission flags, licensing metadata, cover
art, and instrumental metadata through an API. The repository also includes
curated and Internet Archive fallback generators.

## Why Not Download From Spotify

Spotify can provide catalog metadata and, with Premium, playback through the Web
Playback SDK. It is not the right source for downloadable audio files. Spotify
also restricts Audio Features/Audio Analysis access for many newer apps. For the
study catalog we therefore use a public dataset snapshot for metadata and
YouTube embeds for browser playback, not Spotify downloads.

## Current Kaggle Spotify + YouTube Catalog

```bash
npm run kaggle:catalog
```

Generated files:

- `src/data/musicCatalog.json`
- `data/kaggle_spotify_youtube_catalog.csv`
- `data/youtube_lookup_cache.json`

The builder downloads or reads `data/spotify_tracks_dataset.csv` from the
Hugging Face mirror of the Kaggle dataset. The raw CSV is ignored by git. The
compact generated JSON/CSV are committed.

Default filters:

- `instrumentalness >= 0.85`
- `speechiness <= 0.12`
- non-explicit tracks
- playable Spotify track id present
- duration between 90 and 420 seconds
- duplicate artist/title pairs removed

The generator uses 20 instrumental-leaning genre buckets and picks five tracks
per bucket by popularity. It does not force quadrant balance.

For each selected track, the script resolves the first YouTube video for
`artist title official audio`. When `YT_DLP_PYTHONPATH` points to a local
`yt-dlp` install, that path is used first; otherwise the script falls back to a
basic YouTube search-page parse. The app stores the resulting video id, watch
URL, search URL, and embed URL.

The Spotify dataset's `valence` and `energy` fields define the four quadrants:

- `happy`: high valence, high arousal
- `relaxed`: high valence, low arousal
- `tense`: low valence, high arousal
- `sad_low`: low valence, low arousal

Important limitation: Spotify `instrumentalness` is a strong but imperfect
proxy for "no lyrics." Coauthors should audit
`data/kaggle_spotify_youtube_catalog.csv` before formal participant testing.

## Legacy Curated Catalog

```bash
npm run curated:catalog
```

Generated files:

- `src/data/musicCatalog.json`
- `data/curated_instrumental_catalog.csv`

The builder pulls Wikimedia Commons/Incompetech audio metadata, selected
Internet Archive instrumental metadata, direct media URLs, and license URLs.
Tracks are scored by source quality, duration, recognizable titles, and
classification confidence.

## Jamendo Inputs

Create an ignored `.env` file:

```bash
JAMENDO_CLIENT_ID=...
JAMENDO_MAX_TRACKS=100
JAMENDO_REQUIRE_DOWNLOAD_ALLOWED=true
```

Optional discovery tags can be added if the default searches return too few
tracks:

```bash
JAMENDO_DISCOVERY_TAGS=instrumental cinematic piano ambient happy sad
```

Optional local MP3 download for audit:

```bash
JAMENDO_DOWNLOAD_AUDIO=true
JAMENDO_AUDIO_DIR=data/audio/jamendo
```

Audio downloads are ignored by git. The web app uses Jamendo stream URLs in the
catalog so the source repo stays lightweight.

## Jamendo Command

```bash
npm run jamendo:catalog
```

Generated files:

- `src/data/musicCatalog.json`: static catalog consumed by the app.
- `data/jamendo_catalog.csv`: tabular audit/export file.

## No-Login Internet Archive Fallback

If no Jamendo Client ID is available, build a real instrumental catalog from
Internet Archive:

```bash
npm run archive:catalog
```

Generated files:

- `src/data/musicCatalog.json`
- `data/internet_archive_catalog.csv`

The script queries licensed `netlabels` items with instrumental metadata,
selects playable MP3 files, keeps Internet Archive item URLs and license URLs,
and estimates Valence/Arousal from subjects, titles, query context, and file
metadata. You can override the collection for exploration:

```bash
ARCHIVE_COLLECTION=opensource_audio npm run archive:catalog
```

This path avoids account setup, but the music metadata is less curated than
Jamendo. Coauthors should audit the generated CSV before a formal experiment.

## Filtering

The script queries Jamendo with:

- `vocalinstrumental=instrumental`
- `audioformat=mp32`
- `audiodlformat=mp32`
- `include=musicinfo licenses stats`
- cover art required
- playable audio URL required
- download permission required by default

The script does not force quadrant balance. If 100 eligible tracks naturally
produce 11 `sad_low`, 37 `relaxed`, 24 `happy`, and 28 `tense`, that is kept.

## Valence/Arousal Assignment

Jamendo does not expose Spotify-style Audio Features. The script estimates the
two axes from available real metadata:

- Valence: Jamendo mood/theme tags such as `happy`, `uplifting`, `sad`,
  `melancholic`, `dark`, and `dramatic`.
- Arousal: Jamendo speed labels, high/low energy tags, and waveform peak
  statistics. The JSON field remains `energy` for compatibility with common
  music-metadata terminology.

Quadrants:

- `happy`: high valence, high arousal
- `relaxed`: high valence, low arousal
- `tense`: low valence, high arousal
- `sad_low`: low valence, low arousal

These labels are reproducible catalog annotations, not clinical emotion ground
truth.

## App Behavior

Before setup, the participant selects preferred music genres. Random Shuffle
ignores those choices and selects from the full catalog. The hidden adaptive
block first filters to the selected genres, then uses the averaged expression
and optional ECG/HRV state from the just-finished listening window. Adaptive
trials can select from `happy`, `relaxed`, `tense`, or `sad_low` matching pools.
