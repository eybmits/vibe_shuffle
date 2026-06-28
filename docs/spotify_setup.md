# Spotify Setup

Spotify is used for **playback only** (Web Playback SDK). The app does not read
the participant's library and does not use Spotify Audio Features at runtime —
the 100 curated tracks carry their own features (see
[`music_catalog.md`](music_catalog.md)).

## Developer app

Create an app at https://developer.spotify.com/dashboard.

- **APIs/SDKs**: enable **Web API** and **Web Playback SDK**.
- **Redirect URIs**: add the deployed site URL (e.g.
  `https://eybmits.github.io/vibe-shuffle/`) and, for local dev,
  `http://localhost:5173/`. They must match exactly.
- The Client ID is public and is baked into the build; the **Client Secret is
  not needed** for this app — never commit it.

Local env (`.env`, git-ignored):

```bash
VITE_SPOTIFY_CLIENT_ID=your_client_id
# optional; defaults to the current origin + path:
# VITE_SPOTIFY_REDIRECT_URI=http://localhost:5173/
```

## OAuth scopes

Authorization Code with PKCE, **playback scopes only**:

```
streaming
user-read-email
user-read-private
user-read-playback-state
user-modify-playback-state
```

## Development mode (important)

New apps are in **Development mode**. This has two hard limits that apply to
**every** account that signs in:

1. **Allowlist** — each Spotify account must be added under **User Management**
   in the dashboard (name + the account's Spotify email). The app owner counts
   automatically; everyone else must be added. The current tier allows up to
   **5** users. Non-allowlisted accounts get `403` and cannot play.
2. **Spotify Premium** — the Web Playback SDK only plays for Premium accounts.

For more than 5 participants, either rotate the allowlist entries or request a
Quota Extension (production mode) from Spotify.

## Troubleshooting

See [`troubleshooting.md`](troubleshooting.md) for `403` (allowlist), rate
limits, Premium, and redirect-URI issues.
