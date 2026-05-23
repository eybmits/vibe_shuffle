# Real Music Catalog

The preferred production catalog uses Jamendo because it provides real tracks,
stream URLs, download permission flags, licensing metadata, cover art, and
instrumental metadata through an API.

The repository also includes an Internet Archive fallback that needs no login or
API key. That fallback is useful when no Jamendo Client ID is available.

## Why Not Download From Spotify

Spotify can provide catalog metadata and, with Premium, playback through the Web
Playback SDK. It is not the right source for downloadable audio files. Spotify
also restricts Audio Features/Audio Analysis access for many newer apps. For the
study catalog we therefore use Spotify only as an optional playback/metadata
integration, not as the source of downloaded audio.

## Inputs

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

## Command

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
and estimates Valence/Energy from subjects, titles, query context, and file
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

## Valence/Energy Assignment

Jamendo does not expose Spotify-style Audio Features. The script estimates the
two axes from available real metadata:

- Valence: Jamendo mood/theme tags such as `happy`, `uplifting`, `sad`,
  `melancholic`, `dark`, and `dramatic`.
- Energy: Jamendo speed labels, high/low energy tags, and waveform peak
  statistics.

Quadrants:

- `happy`: high valence, high energy
- `relaxed`: high valence, low energy
- `tense`: low valence, high energy
- `sad_low`: low valence, low energy

These labels are reproducible catalog annotations, not clinical emotion ground
truth.

## App Behavior

Random Shuffle ignores the catalog label when selecting tracks. Vibe Shuffle
uses the detected expression state. The current face-expression MVP only emits
`happy` or `sad_low`, so adaptive trials select from those matching pools.
