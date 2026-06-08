# Troubleshooting

## No Audio

- Click `Start session`; browser audio requires a user gesture.
- Check system volume and browser tab mute state.
- Current public builds use embedded YouTube videos. If an embed is blocked,
  open the visible `YouTube` link for that track and audit the catalog row.
- If using Spotify playback, confirm Spotify Premium and successful login.
- If using the fallback catalog, confirm the direct MP3 URLs are reachable.

## YouTube Video Is Wrong Or Blocked

The Kaggle catalog stores the first YouTube result for
`artist title official audio`. This is reproducible but not perfect. Rebuild the
catalog after editing `data/youtube_lookup_cache.json`, or delete the relevant
cache entry and rerun:

```bash
YT_DLP_PYTHONPATH=/tmp/vibe_shuffle_yt_dlp npm run kaggle:catalog
```

If a video is age-restricted or embed-blocked, replace that cache entry with a
different `videoId`, `watchUrl`, and `embedUrl`, then rebuild/commit the catalog.

## Rating Does Not Appear

The rating modal appears after the listening window finishes. The current
window is 30 seconds. The participant can also click `Jump to rating` to open
the rating modal early. The next track cannot start until a rating is selected.

## Camera Blocked

- Allow camera permission in the browser.
- Reload the page after changing browser permissions.
- The app can start without camera access; it records a temporary fallback
  expression state until the camera is enabled.

## Heart-Rate Sensor Does Not Connect

- Use a Chromium-based browser with Web Bluetooth enabled.
- Use HTTPS or `localhost`; Web Bluetooth is not available from ordinary
  insecure origins.
- Use a device that exposes the standard Bluetooth Heart Rate Service.
- If the sensor exposes bpm but no RR intervals, the app logs HR but marks HRV
  quality as `bpm_only`.
- The experiment can run without ECG/HRV; click `Skip ECG` or use the `Demo`
  sensor for local testing.

## Spotify Catalog Script Fails

`Missing SPOTIFY_CLIENT_ID` means credentials are not set.

Create an ignored `.env` file or export variables in the shell:

```bash
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

If Audio Features mode returns `403`, switch to curated mode:

```bash
SPOTIFY_CATALOG_MODE=curated
SPOTIFY_HAPPY_PLAYLIST_URL=...
SPOTIFY_SAD_PLAYLIST_URL=...
```

## Jamendo Catalog Script Fails

`Missing JAMENDO_CLIENT_ID` means no Jamendo developer credential is available.
Create a Jamendo developer app, add the Client ID to an ignored `.env` file, and
rerun:

```bash
JAMENDO_CLIENT_ID=...
npm run jamendo:catalog
```

If fewer than 100 tracks are saved, loosen the discovery filters or add tags:

```bash
JAMENDO_DISCOVERY_TAGS="instrumental cinematic ambient piano electronic"
```

If local MP3 downloads fail for some tracks, leave `JAMENDO_DOWNLOAD_AUDIO=false`;
the app can still play the Jamendo stream URLs stored in the catalog.

## Kaggle Catalog Script Fails

The script downloads the public dataset mirror to
`data/spotify_tracks_dataset.csv`, which is ignored by git. If the mirror is
temporarily unavailable, download the Kaggle dataset manually and save its CSV to
that path, then rerun:

```bash
npm run kaggle:catalog
```

For more reliable YouTube id lookup, install `yt-dlp` into a temporary folder
and pass it through `YT_DLP_PYTHONPATH`.

## Jamendo Login Is Not Available

Use the no-login Internet Archive fallback:

```bash
npm run archive:catalog
```

This creates the same `src/data/musicCatalog.json` file from licensed
Internet Archive instrumental MP3s.

## GitHub Pages Shows An Old Build

GitHub Pages and CDN caches can lag behind the latest push. Verify the HTML:

```bash
curl -L https://eybmits.github.io/vibe_shuffle_site/ | grep assets
```

Then hard-refresh the browser.
