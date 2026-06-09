import { trackNameKey } from "./trackKey.js";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const PAGE_LIMIT = 50;
// Safety bounds only — high enough to cover whole personal libraries.
const MAX_LIBRARY_TRACKS = 10000;
const MAX_PLAYLISTS = 200;

export const EMOTION_QUADRANTS = {
  happy: {
    label: "Happy",
    tag: "happy",
    accent: "#34d399",
    valence: 0.82,
    energy: 0.78,
    description: "High valence, high arousal",
    palette: ["#0f2e25", "#34d399", "#a7f3d0"],
  },
  relaxed: {
    label: "Relaxed",
    tag: "relaxed",
    accent: "#22d3ee",
    valence: 0.72,
    energy: 0.28,
    description: "High valence, low arousal",
    palette: ["#082635", "#22d3ee", "#a5f3fc"],
  },
  tense: {
    label: "Tense",
    tag: "tense",
    accent: "#fb923c",
    valence: 0.28,
    energy: 0.74,
    description: "Low valence, high arousal",
    palette: ["#33180a", "#fb923c", "#fed7aa"],
  },
  sad_low: {
    label: "Sad-low",
    tag: "sad_low",
    accent: "#a78bfa",
    valence: 0.3,
    energy: 0.26,
    description: "Low valence, low arousal",
    palette: ["#1d1538", "#a78bfa", "#ddd6fe"],
  },
};

export function quadrantFromAxes(valence, energy) {
  if (valence >= 0.5 && energy >= 0.5) return "happy";
  if (valence >= 0.5 && energy < 0.5) return "relaxed";
  if (valence < 0.5 && energy >= 0.5) return "tense";
  return "sad_low";
}

// Bump when the lookup format changes — busts browser/CDN caches of the
// same-named JSON file.
const FEATURE_LOOKUP_VERSION = "5";

let featureLookupPromise = null;

export function loadFeatureLookup() {
  featureLookupPromise ??= fetch(`./feature-lookup.json?v=${FEATURE_LOOKUP_VERSION}`).then(
    (response) => {
      if (!response.ok) {
        featureLookupPromise = null;
        throw new Error(`Feature lookup failed to load (HTTP ${response.status}).`);
      }
      return response.json();
    },
  );

  return featureLookupPromise;
}

function normalizeApiTrack(track, sourceLabel) {
  if (!track?.id || track.is_local || track.type !== "track") return null;

  return {
    id: `spotify-${track.id}`,
    spotifyId: track.id,
    spotifyUri: track.uri ?? `spotify:track:${track.id}`,
    title: track.name ?? "Untitled track",
    artistNames: (track.artists ?? []).map((artist) => artist.name).filter(Boolean),
    artist: (track.artists ?? []).map((artist) => artist.name).join(", ") || "Unknown artist",
    album: track.album?.name ?? "",
    albumImageUrl: track.album?.images?.[0]?.url ?? null,
    durationMs: track.duration_ms ?? null,
    popularity: Number(track.popularity ?? 0),
    externalUrl: track.external_urls?.spotify ?? null,
    librarySource: sourceLabel,
  };
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After") ?? 1);
    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 0.2) * 1000));
    return fetchJson(url, token);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload?.error?.message ?? "";
    } catch {
      // Keep the bare status when the body is not JSON.
    }
    throw new Error(
      `Spotify API request failed (HTTP ${response.status}${detail ? `: ${detail}` : ""}).`,
    );
  }

  return response.json();
}

async function fetchPaginated(token, firstUrl, getItems, onItems, maxItems) {
  let url = firstUrl;
  let collected = 0;

  while (url && collected < maxItems) {
    const payload = await fetchJson(url, token);
    const items = getItems(payload) ?? [];
    collected += items.length;
    onItems(items);
    url = payload.next;
  }
}

// Cheap permission probe: /me answers 403 for accounts that are not
// allowlisted in the developer app, before we touch any library endpoint.
export async function fetchUserProfile(ensureToken) {
  const token = await ensureToken();
  if (!token) throw new Error("Spotify login expired. Please reconnect.");
  const payload = await fetchJson(`${SPOTIFY_API_BASE}/me`, token);

  return {
    displayName: payload.display_name ?? payload.id ?? "Spotify user",
    email: payload.email ?? "",
    id: payload.id ?? "",
    product: payload.product ?? "",
  };
}

export async function fetchUserLibrary(ensureToken, onProgress = () => {}) {
  const token = await ensureToken();
  if (!token) throw new Error("Spotify login expired. Please reconnect.");

  const tracksById = new Map();
  let playlistCount = 0;

  const addTracks = (apiTracks, sourceLabel) => {
    for (const apiTrack of apiTracks) {
      if (tracksById.size >= MAX_LIBRARY_TRACKS) return;
      const normalized = normalizeApiTrack(apiTrack, sourceLabel);
      if (normalized && !tracksById.has(normalized.spotifyId)) {
        tracksById.set(normalized.spotifyId, normalized);
      }
    }
    onProgress({ trackCount: tracksById.size, playlistCount });
  };

  let lastError = null;

  try {
    await fetchPaginated(
      token,
      `${SPOTIFY_API_BASE}/me/tracks?limit=${PAGE_LIMIT}`,
      (payload) => payload.items,
      (items) => addTracks(items.map((item) => item.track), "liked_songs"),
      MAX_LIBRARY_TRACKS,
    );
  } catch (error) {
    lastError = error;
    console.warn("[vibe-shuffle] liked songs could not be loaded:", error.message);
  }

  const playlists = [];
  try {
    await fetchPaginated(
      token,
      `${SPOTIFY_API_BASE}/me/playlists?limit=${PAGE_LIMIT}`,
      (payload) => payload.items,
      (items) => playlists.push(...items.filter(Boolean)),
      MAX_PLAYLISTS,
    );
  } catch (error) {
    lastError = error;
    console.warn("[vibe-shuffle] playlist list could not be loaded:", error.message);
  }

  let skippedPlaylists = 0;

  for (const playlist of playlists.slice(0, MAX_PLAYLISTS)) {
    if (tracksById.size >= MAX_LIBRARY_TRACKS) break;

    // Spotify blocks API access to its own editorial/algorithmic playlists
    // (Discover Weekly, Daily Mix, …) for newer apps — they answer 403/404.
    if (playlist.owner?.id === "spotify") {
      skippedPlaylists += 1;
      continue;
    }

    playlistCount += 1;
    const fields = encodeURIComponent(
      "next,items(track(id,uri,name,type,is_local,duration_ms,popularity,artists(name),album(name,images),external_urls))",
    );

    try {
      await fetchPaginated(
        token,
        `${SPOTIFY_API_BASE}/playlists/${playlist.id}/tracks?limit=${PAGE_LIMIT}&fields=${fields}`,
        (payload) => payload.items,
        (items) => addTracks(items.map((item) => item.track), "playlist"),
        MAX_LIBRARY_TRACKS - tracksById.size,
      );
    } catch (error) {
      // One inaccessible playlist must not abort the whole library load.
      skippedPlaylists += 1;
      console.warn(
        `[vibe-shuffle] playlist "${playlist.name}" skipped:`,
        error.message,
      );
    }
  }

  if (skippedPlaylists) {
    console.info(`[vibe-shuffle] ${skippedPlaylists} inaccessible playlists skipped.`);
  }

  if (!tracksById.size && lastError) {
    throw lastError;
  }

  return Array.from(tracksById.values());
}

export function matchTracksToFeatures(tracks, lookup) {
  const ids = lookup.ids ?? lookup;
  const names = lookup.names ?? {};
  const matched = [];

  for (const track of tracks) {
    let features = ids[track.spotifyId];
    let categorySource = "lookup_id";

    if (!features) {
      const artistCandidates = track.artistNames?.length ? track.artistNames : [track.artist];
      for (const artist of artistCandidates) {
        const nameKey = trackNameKey(artist, track.title);
        if (nameKey && names[nameKey]) {
          features = names[nameKey];
          categorySource = "lookup_name";
          break;
        }
      }
    }
    if (!features) continue;

    const [valence, energy, instrumentalness] = features;
    const quadrant = quadrantFromAxes(valence, energy);
    const style = EMOTION_QUADRANTS[quadrant];

    matched.push({
      ...track,
      valence,
      energy,
      instrumentalness: instrumentalness ?? 0,
      quadrant,
      categorySource,
      accent: style.accent,
      palette: style.palette,
    });
  }

  return matched;
}
