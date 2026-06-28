# Troubleshooting

## Spotify won't play / 403

The app is in **Development mode** (see [`spotify_setup.md`](spotify_setup.md)).

- **"This account isn't approved" / 403** — the signed-in Spotify account is not
  on the allowlist. Add its email under **User Management** in the Spotify
  Developer Dashboard, then have the user click **Switch account** and sign in
  again. The app owner is allowed automatically.
- **Playback rejected even though Premium** — the account still needs to be
  allowlisted; Premium alone is not enough.
- **No sound after pressing play** — confirm the web player shows "connected and
  ready" in step 1 and that the account has **Spotify Premium**.

## "Spotify is rate-limiting this app"

Spotify rate limits are **per app**, shared across all users. Many rapid
sign-ins or reloads can trip it. Wait a few minutes without reloading, then try
again. (The app no longer reads the Spotify library, so normal use does not hit
library rate limits.)

## Rating does not appear

The two-step rating opens after the **60 s** listening window. The participant
can also click **Rate now** to open it early. The next track does not start
until both ratings (liking, then mood-fit) are submitted.

## Camera blocked

- Allow camera permission in the browser and reload after changing it.
- The session can run without the camera; valence then stays neutral and the
  Vibe block relies on arousal/movement only.

## Heart-rate sensor does not connect

- Use a Chromium-based browser with Web Bluetooth, over HTTPS or `localhost`.
- Use a device exposing the standard Bluetooth **Heart Rate** service.
- If the device reports bpm but no RR intervals, HRV quality is `bpm_only` and
  arousal is not driven by HRV.
- The session can run without a sensor; click **Skip ECG**, or use the **Demo**
  sensor for local testing (it oscillates arousal up and down).

## GitHub Pages shows an old build

GitHub Pages and CDN caches can lag a push. Verify the served bundle:

```bash
curl -L https://eybmits.github.io/vibe-shuffle/ | grep assets
```

Then hard-refresh the browser (Cmd/Ctrl+Shift+R), or use a private window.
