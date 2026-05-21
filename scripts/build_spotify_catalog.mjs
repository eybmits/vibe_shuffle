import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const MAX_TRACKS = 100;
const MIN_INSTRUMENTALNESS = 0.5;
const MAX_SPEECHINESS = 0.33;
const CURATED_PLAYLIST_ENVS = {
  happy: "SPOTIFY_HAPPY_PLAYLIST_URL",
  relaxed: "SPOTIFY_RELAXED_PLAYLIST_URL",
  tense: "SPOTIFY_TENSE_PLAYLIST_URL",
  sad_low: "SPOTIFY_SAD_PLAYLIST_URL",
};

const CATEGORY_STYLES = {
  happy: {
    accent: "#22c55e",
    palette: ["#f0fdf4", "#86efac", "#15803d"],
    valence: 0.86,
    energy: 0.78,
  },
  relaxed: {
    accent: "#14b8a6",
    palette: ["#ecfeff", "#99f6e4", "#0f766e"],
    valence: 0.72,
    energy: 0.28,
  },
  tense: {
    accent: "#f97316",
    palette: ["#fff7ed", "#fdba74", "#c2410c"],
    valence: 0.28,
    energy: 0.74,
  },
  sad_low: {
    accent: "#818cf8",
    palette: ["#eef2ff", "#c7d2fe", "#4f46e5"],
    valence: 0.26,
    energy: 0.28,
  },
};

async function loadDotEnv() {
  try {
    const content = await readFile(path.resolve(".env"), "utf8");

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 0) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function optionalEnv(name) {
  return process.env[name]?.trim() || "";
}

function parsePlaylistId(input, label = "SPOTIFY_PLAYLIST_URL") {
  if (!input) throw new Error(`Missing ${label}.`);

  if (input.startsWith("spotify:playlist:")) {
    return input.split(":").at(-1);
  }

  const directId = input.match(/^[A-Za-z0-9]{20,}$/)?.[0];
  if (directId) return directId;

  const match = input.match(/playlist\/([A-Za-z0-9]+)/);
  if (match?.[1]) return match[1];

  throw new Error(`${label} must be a playlist URL, Spotify URI, or playlist ID.`);
}

async function getAccessToken(clientId, clientSecret) {
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify token request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return payload.access_token;
}

async function spotifyFetch(pathname, token) {
  const response = await fetch(`${SPOTIFY_API_URL}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? 2);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return spotifyFetch(pathname, token);
  }

  if (response.status === 403 && pathname.startsWith("/audio-features")) {
    throw new Error(
      "Spotify returned 403 for Audio Features. Your Spotify app likely lacks access to deprecated Audio Features/Audio Analysis endpoints.",
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify API request failed ${pathname} (${response.status}): ${text}`);
  }

  return response.json();
}

async function fetchPlaylistTracks(playlistId, token) {
  const tracks = [];
  let offset = 0;
  const fields = [
    "items(track(id,uri,name,artists(name),album(name,images(url,width,height)),duration_ms,explicit,is_playable,external_urls.spotify,preview_url,popularity))",
    "next",
    "total",
  ].join(",");

  while (true) {
    const payload = await spotifyFetch(
      `/playlists/${playlistId}/tracks?limit=100&offset=${offset}&fields=${encodeURIComponent(fields)}`,
      token,
    );

    for (const item of payload.items ?? []) {
      if (item.track?.id) tracks.push(item.track);
    }

    if (!payload.next) break;
    offset += 100;
  }

  return tracks;
}

async function fetchAudioFeatures(trackIds, token) {
  const features = new Map();

  for (let index = 0; index < trackIds.length; index += 100) {
    const batch = trackIds.slice(index, index + 100);
    const payload = await spotifyFetch(`/audio-features?ids=${batch.join(",")}`, token);

    for (const item of payload.audio_features ?? []) {
      if (item?.id) features.set(item.id, item);
    }
  }

  return features;
}

function quadrantFromAxes(valence, energy) {
  if (valence >= 0.5 && energy >= 0.5) return "happy";
  if (valence >= 0.5 && energy < 0.5) return "relaxed";
  if (valence < 0.5 && energy >= 0.5) return "tense";
  return "sad_low";
}

function bestImage(images = []) {
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
}

function normalizeFeatureTrack(track, features) {
  const quadrant = quadrantFromAxes(features.valence, features.energy);
  const style = CATEGORY_STYLES[quadrant];

  return {
    id: track.id,
    spotifyId: track.id,
    spotifyUri: track.uri,
    title: track.name,
    artist: track.artists?.map((artist) => artist.name).join(", ") ?? "Unknown artist",
    album: track.album?.name ?? "",
    albumImageUrl: bestImage(track.album?.images),
    externalUrl: track.external_urls?.spotify ?? null,
    durationMs: track.duration_ms,
    explicit: Boolean(track.explicit),
    popularity: track.popularity ?? null,
    previewUrl: track.preview_url ?? null,
    audioUrl: track.preview_url ?? null,
    valence: Number(features.valence.toFixed(4)),
    energy: Number(features.energy.toFixed(4)),
    instrumentalness: Number(features.instrumentalness.toFixed(4)),
    speechiness: Number(features.speechiness.toFixed(4)),
    danceability: Number(features.danceability.toFixed(4)),
    tempo: Number(features.tempo.toFixed(3)),
    categorySource: "spotify_audio_features",
    estimatedFeatures: false,
    sourcePlaylist: null,
    quadrant,
    accent: style.accent,
    palette: style.palette,
  };
}

function normalizeCuratedTrack(track, quadrant, sourcePlaylist) {
  const style = CATEGORY_STYLES[quadrant];

  return {
    id: track.id,
    spotifyId: track.id,
    spotifyUri: track.uri,
    title: track.name,
    artist: track.artists?.map((artist) => artist.name).join(", ") ?? "Unknown artist",
    album: track.album?.name ?? "",
    albumImageUrl: bestImage(track.album?.images),
    externalUrl: track.external_urls?.spotify ?? null,
    durationMs: track.duration_ms,
    explicit: Boolean(track.explicit),
    popularity: track.popularity ?? null,
    previewUrl: track.preview_url ?? null,
    audioUrl: track.preview_url ?? null,
    valence: style.valence,
    energy: style.energy,
    instrumentalness: 1,
    speechiness: 0.02,
    danceability: 0,
    tempo: 0,
    categorySource: "curated_playlist",
    estimatedFeatures: true,
    sourcePlaylist,
    quadrant,
    accent: style.accent,
    palette: style.palette,
  };
}

function toCsv(rows) {
  const columns = [
    "id",
    "spotifyId",
    "spotifyUri",
    "title",
    "artist",
    "album",
    "quadrant",
    "valence",
    "energy",
    "instrumentalness",
    "speechiness",
    "danceability",
    "tempo",
    "durationMs",
    "audioUrl",
    "categorySource",
    "estimatedFeatures",
    "sourcePlaylist",
    "externalUrl",
  ];

  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  };

  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\n");
}

function distribution(rows) {
  return rows.reduce(
    (counts, row) => ({
      ...counts,
      [row.quadrant]: (counts[row.quadrant] ?? 0) + 1,
    }),
    { happy: 0, relaxed: 0, tense: 0, sad_low: 0 },
  );
}

function interleave(groups) {
  const output = [];
  const maxLength = Math.max(...groups.map((group) => group.length), 0);

  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      if (group[index]) output.push(group[index]);
    }
  }

  return output;
}

function getCatalogMode() {
  const explicitMode = optionalEnv("SPOTIFY_CATALOG_MODE");
  if (explicitMode) return explicitMode;

  return Object.values(CURATED_PLAYLIST_ENVS).some(optionalEnv) ? "curated" : "features";
}

async function buildFeatureCatalog(token) {
  const playlistUrl = requiredEnv("SPOTIFY_PLAYLIST_URL");
  const playlistId = parsePlaylistId(playlistUrl);
  const playlistTracks = await fetchPlaylistTracks(playlistId, token);
  const uniqueTracks = [...new Map(playlistTracks.map((track) => [track.id, track])).values()];
  const features = await fetchAudioFeatures(uniqueTracks.map((track) => track.id), token);

  const eligible = uniqueTracks
    .map((track) => {
      const feature = features.get(track.id);
      return feature ? normalizeFeatureTrack(track, feature) : null;
    })
    .filter(Boolean)
    .filter((track) => track.albumImageUrl)
    .filter((track) => track.instrumentalness >= MIN_INSTRUMENTALNESS)
    .filter((track) => track.speechiness <= MAX_SPEECHINESS)
    .filter((track) => track.spotifyUri)
    .slice(0, MAX_TRACKS);

  return {
    eligible,
    fetchedCount: uniqueTracks.length,
    payloadMeta: {
      sourcePlaylist: playlistUrl,
      sourcePlaylistId: playlistId,
      source: "spotify",
      filters: {
        maxTracks: MAX_TRACKS,
        minInstrumentalness: MIN_INSTRUMENTALNESS,
        maxSpeechiness: MAX_SPEECHINESS,
      },
    },
  };
}

async function buildCuratedCatalog(token) {
  const categorySources = Object.entries(CURATED_PLAYLIST_ENVS)
    .map(([quadrant, envName]) => ({
      envName,
      playlistUrl: optionalEnv(envName),
      quadrant,
    }))
    .filter((source) => source.playlistUrl);

  if (!categorySources.length) {
    throw new Error(
      "Curated mode requires at least one category playlist, e.g. SPOTIFY_HAPPY_PLAYLIST_URL and SPOTIFY_SAD_PLAYLIST_URL.",
    );
  }

  const groups = [];
  const sourcePlaylists = {};

  for (const source of categorySources) {
    const playlistId = parsePlaylistId(source.playlistUrl, source.envName);
    const tracks = await fetchPlaylistTracks(playlistId, token);
    sourcePlaylists[source.quadrant] = {
      envName: source.envName,
      playlistId,
      playlistUrl: source.playlistUrl,
      fetchedTracks: tracks.length,
    };
    groups.push(
      tracks
        .filter((track) => track.album?.images?.length)
        .filter((track) => track.uri)
        .map((track) => normalizeCuratedTrack(track, source.quadrant, source.playlistUrl)),
    );
  }

  const seen = new Set();
  const eligible = interleave(groups)
    .filter((track) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    })
    .slice(0, MAX_TRACKS);

  return {
    eligible,
    fetchedCount: Object.values(sourcePlaylists).reduce(
      (total, source) => total + source.fetchedTracks,
      0,
    ),
    payloadMeta: {
      source: "spotify-curated-playlists",
      sourcePlaylists,
      filters: {
        maxTracks: MAX_TRACKS,
        assignment: "playlist_category",
        note:
          "Valence, energy and instrumentalness are category estimates in curated mode; Spotify Audio Features are not used.",
      },
    },
  };
}

async function main() {
  await loadDotEnv();

  const clientId = requiredEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requiredEnv("SPOTIFY_CLIENT_SECRET");
  const mode = getCatalogMode();
  if (!["features", "curated"].includes(mode)) {
    throw new Error("SPOTIFY_CATALOG_MODE must be either 'features' or 'curated'.");
  }

  const token = await getAccessToken(clientId, clientSecret);
  const { eligible, fetchedCount, payloadMeta } =
    mode === "curated" ? await buildCuratedCatalog(token) : await buildFeatureCatalog(token);

  const payload = {
    ...payloadMeta,
    generatedAt: new Date().toISOString(),
    catalogMode: mode,
    distribution: distribution(eligible),
    tracks: eligible,
  };

  await mkdir(path.resolve("src/data"), { recursive: true });
  await mkdir(path.resolve("data"), { recursive: true });
  await writeFile(
    path.resolve("src/data/spotifyCatalog.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  await writeFile(path.resolve("data/spotify_catalog.csv"), `${toCsv(eligible)}\n`);

  console.log(`Catalog mode: ${mode}`);
  console.log(`Fetched ${fetchedCount} playlist tracks.`);
  console.log(`Saved ${eligible.length} catalog tracks.`);
  console.table(distribution(eligible));

  if (eligible.length < MAX_TRACKS) {
    console.warn(
      `Only ${eligible.length}/${MAX_TRACKS} tracks were saved. The app will use all eligible tracks without forcing quadrant balance.`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
