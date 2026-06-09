import { artistNameKey, trackNameKey } from "./trackKey.js";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const PAGE_LIMIT = 50;
const MAX_LIBRARY_TRACKS = 1500;
const MAX_PLAYLISTS = 50;

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
const FEATURE_LOOKUP_VERSION = "3";

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
    primaryArtist: track.artists?.[0]?.name ?? "",
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
    throw new Error(`Spotify API request failed (HTTP ${response.status}).`);
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

  await fetchPaginated(
    token,
    `${SPOTIFY_API_BASE}/me/tracks?limit=${PAGE_LIMIT}`,
    (payload) => payload.items,
    (items) => addTracks(items.map((item) => item.track), "liked_songs"),
    MAX_LIBRARY_TRACKS,
  );

  const playlists = [];
  await fetchPaginated(
    token,
    `${SPOTIFY_API_BASE}/me/playlists?limit=${PAGE_LIMIT}`,
    (payload) => payload.items,
    (items) => playlists.push(...items.filter(Boolean)),
    MAX_PLAYLISTS,
  );

  for (const playlist of playlists.slice(0, MAX_PLAYLISTS)) {
    if (tracksById.size >= MAX_LIBRARY_TRACKS) break;
    playlistCount += 1;

    const fields = encodeURIComponent(
      "next,items(track(id,uri,name,type,is_local,duration_ms,popularity,artists(name),album(name,images),external_urls))",
    );
    await fetchPaginated(
      token,
      `${SPOTIFY_API_BASE}/playlists/${playlist.id}/tracks?limit=${PAGE_LIMIT}&fields=${fields}`,
      (payload) => payload.items,
      (items) => addTracks(items.map((item) => item.track), "playlist"),
      MAX_LIBRARY_TRACKS - tracksById.size,
    );
  }

  return Array.from(tracksById.values());
}

export function matchTracksToFeatures(tracks, lookup) {
  const ids = lookup.ids ?? lookup;
  const names = lookup.names ?? {};
  const artists = lookup.artists ?? {};
  const matched = [];

  for (const track of tracks) {
    const nameKey = trackNameKey(track.primaryArtist || track.artist, track.title);
    const artistKey = artistNameKey(track.primaryArtist || track.artist);

    let features = ids[track.spotifyId];
    let categorySource = "lookup_id";
    if (!features && nameKey) {
      features = names[nameKey];
      categorySource = "lookup_name";
    }
    if (!features && artistKey) {
      features = artists[artistKey];
      categorySource = "lookup_artist_mean";
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
