import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const JAMENDO_API_URL = "https://api.jamendo.com/v3.0";
const DEFAULT_MAX_TRACKS = 100;
const MAX_API_LIMIT = 200;

const CATEGORY_STYLES = {
  happy: {
    accent: "#22c55e",
    palette: ["#f0fdf4", "#86efac", "#15803d"],
  },
  relaxed: {
    accent: "#14b8a6",
    palette: ["#ecfeff", "#99f6e4", "#0f766e"],
  },
  tense: {
    accent: "#f97316",
    palette: ["#fff7ed", "#fdba74", "#c2410c"],
  },
  sad_low: {
    accent: "#818cf8",
    palette: ["#eef2ff", "#c7d2fe", "#4f46e5"],
  },
};

const SPEED_ENERGY = {
  verylow: 0.16,
  low: 0.3,
  medium: 0.52,
  high: 0.74,
  veryhigh: 0.88,
};

const POSITIVE_VALENCE_TAGS = new Map([
  ["happy", 0.32],
  ["joyful", 0.3],
  ["joy", 0.28],
  ["positive", 0.28],
  ["uplifting", 0.26],
  ["hopeful", 0.18],
  ["fun", 0.18],
  ["bright", 0.16],
  ["summer", 0.13],
  ["groovy", 0.12],
  ["funk", 0.1],
  ["pop", 0.08],
]);

const NEGATIVE_VALENCE_TAGS = new Map([
  ["sad", -0.34],
  ["melancholic", -0.3],
  ["melancholy", -0.3],
  ["dark", -0.26],
  ["lonely", -0.26],
  ["dramatic", -0.18],
  ["emotional", -0.14],
  ["suspense", -0.24],
  ["horror", -0.34],
  ["trailer", -0.1],
  ["cinematic", -0.06],
]);

const HIGH_ENERGY_TAGS = new Map([
  ["energetic", 0.3],
  ["action", 0.28],
  ["epic", 0.24],
  ["powerful", 0.22],
  ["dance", 0.2],
  ["rock", 0.18],
  ["electronic", 0.16],
  ["groovy", 0.16],
  ["funk", 0.14],
  ["upbeat", 0.18],
  ["trailer", 0.16],
  ["suspense", 0.15],
]);

const LOW_ENERGY_TAGS = new Map([
  ["relaxing", -0.3],
  ["relaxation", -0.28],
  ["calm", -0.28],
  ["ambient", -0.22],
  ["meditation", -0.28],
  ["lounge", -0.18],
  ["piano", -0.1],
  ["acoustic", -0.12],
  ["sad", -0.08],
  ["soft", -0.16],
]);

const DEFAULT_SEARCH_PLAN = [
  {
    label: "popular-instrumental",
    params: {
      order: "popularity_total",
    },
  },
  {
    label: "happy-instrumental",
    params: {
      fuzzytags: "happy positive uplifting fun",
      speed: "medium high veryhigh",
      boost: "popularity_total",
    },
  },
  {
    label: "relaxed-instrumental",
    params: {
      fuzzytags: "relaxing calm ambient lounge meditation",
      speed: "verylow low medium",
      boost: "popularity_total",
    },
  },
  {
    label: "tense-instrumental",
    params: {
      fuzzytags: "dramatic suspense action epic trailer dark",
      speed: "medium high veryhigh",
      boost: "popularity_total",
    },
  },
  {
    label: "sad-low-instrumental",
    params: {
      fuzzytags: "sad melancholic emotional cinematic piano",
      speed: "verylow low medium",
      boost: "popularity_total",
    },
  },
  {
    label: "featured-background",
    params: {
      featured: "1",
      fuzzytags: "soundtrack cinematic instrumental",
      boost: "popularity_total",
    },
  },
];

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
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Create a Jamendo developer app and add ${name} to .env.`);
  }
  return value;
}

function optionalEnv(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function boolEnv(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function splitList(value) {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSearchPlan() {
  const customTags = splitList(optionalEnv("JAMENDO_DISCOVERY_TAGS"));
  if (!customTags.length) return DEFAULT_SEARCH_PLAN;

  return [
    {
      label: "custom-tags",
      params: {
        fuzzytags: customTags.join(" "),
        boost: "popularity_total",
      },
    },
    ...DEFAULT_SEARCH_PLAN,
  ];
}

function buildJamendoUrl(params) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, value);
  }

  return `${JAMENDO_API_URL}/tracks/?${query.toString()}`;
}

async function jamendoFetch(params) {
  const response = await fetch(buildJamendoUrl(params));
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Jamendo API request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const payload = JSON.parse(text);
  if (payload.headers?.status !== "success") {
    throw new Error(
      `Jamendo API failed (${payload.headers?.code ?? "unknown"}): ${
        payload.headers?.error_message ?? "Unknown error"
      }`,
    );
  }

  return payload;
}

function parseWaveform(waveform) {
  if (!waveform) return [];

  try {
    const parsed = typeof waveform === "string" ? JSON.parse(waveform) : waveform;
    return Array.isArray(parsed.peaks)
      ? parsed.peaks.map((value) => Number(value)).filter(Number.isFinite)
      : [];
  } catch {
    return [];
  }
}

function getAllTags(track) {
  const tags = track.musicinfo?.tags ?? {};
  return [
    track.musicinfo?.vocalinstrumental,
    track.musicinfo?.acousticelectric,
    track.musicinfo?.speed,
    ...(tags.genres ?? []),
    ...(tags.instruments ?? []),
    ...(tags.vartags ?? []),
  ]
    .filter(Boolean)
    .map((tag) => String(tag).toLowerCase().trim());
}

function weightedTagScore(tags, positiveMap, negativeMap, base = 0.5) {
  let score = base;
  const matches = [];

  for (const tag of tags) {
    for (const [needle, weight] of positiveMap) {
      if (tag.includes(needle)) {
        score += weight;
        matches.push(`${needle}:${weight}`);
      }
    }

    for (const [needle, weight] of negativeMap) {
      if (tag.includes(needle)) {
        score += weight;
        matches.push(`${needle}:${weight}`);
      }
    }
  }

  return {
    score: clamp(score, 0.05, 0.95),
    confidence: clamp(Math.abs(score - base) * 1.6 + matches.length * 0.06, 0.1, 0.95),
    matches,
  };
}

function waveformEnergy(peaks) {
  if (!peaks.length) return null;

  const normalized = peaks.map((peak) => clamp(peak / 100, 0, 1));
  const mean = average(normalized);
  const spread = standardDeviation(normalized);
  const top = average([...normalized].sort((a, b) => b - a).slice(0, 20));
  return clamp(mean * 0.5 + spread * 0.22 + top * 0.28, 0.05, 0.95);
}

function quadrantFromAxes(valence, energy) {
  if (valence >= 0.5 && energy >= 0.5) return "happy";
  if (valence >= 0.5 && energy < 0.5) return "relaxed";
  if (valence < 0.5 && energy >= 0.5) return "tense";
  return "sad_low";
}

function estimateAffectiveFeatures(track) {
  const tags = getAllTags(track);
  const speed = track.musicinfo?.speed ?? "medium";
  const speedEnergy = SPEED_ENERGY[speed] ?? 0.52;
  const peaks = parseWaveform(track.waveform);
  const waveEnergy = waveformEnergy(peaks) ?? speedEnergy;
  const valenceTags = weightedTagScore(tags, POSITIVE_VALENCE_TAGS, NEGATIVE_VALENCE_TAGS);
  const energyTags = weightedTagScore(tags, HIGH_ENERGY_TAGS, LOW_ENERGY_TAGS);

  const valence = clamp(
    valenceTags.score * 0.76 + (speedEnergy >= 0.62 ? 0.56 : 0.48) * 0.1 + 0.5 * 0.14,
    0.05,
    0.95,
  );
  const energy = clamp(speedEnergy * 0.48 + waveEnergy * 0.28 + energyTags.score * 0.24, 0.05, 0.95);
  const quadrant = quadrantFromAxes(valence, energy);

  return {
    energy,
    quadrant,
    valence,
    confidence: clamp(
      valenceTags.confidence * 0.46 +
        energyTags.confidence * 0.34 +
        (peaks.length ? 0.2 : 0.08),
      0.1,
      0.95,
    ),
    details: {
      speed,
      speedEnergy: Number(speedEnergy.toFixed(4)),
      waveformEnergy: Number(waveEnergy.toFixed(4)),
      waveformPeakCount: peaks.length,
      valenceTagScore: Number(valenceTags.score.toFixed(4)),
      energyTagScore: Number(energyTags.score.toFixed(4)),
      matchedValenceTags: valenceTags.matches,
      matchedEnergyTags: energyTags.matches,
      rawTags: tags,
    },
  };
}

function isEligibleTrack(track, requireDownloadAllowed) {
  const vocalInstrumental = track.musicinfo?.vocalinstrumental;
  const hasAllowedDownload =
    !requireDownloadAllowed || (track.audiodownload_allowed === true && Boolean(track.audiodownload));

  return (
    track.id &&
    track.name &&
    track.artist_name &&
    track.audio &&
    track.image &&
    vocalInstrumental === "instrumental" &&
    hasAllowedDownload
  );
}

function normalizeTrack(track, sourceSearch) {
  const affective = estimateAffectiveFeatures(track);
  const style = CATEGORY_STYLES[affective.quadrant];
  const durationMs = Number(track.duration ?? 0) * 1000;

  return {
    id: `jamendo-${track.id}`,
    jamendoId: track.id,
    spotifyId: null,
    spotifyUri: null,
    title: track.name,
    artist: track.artist_name,
    album: track.album_name ?? "",
    albumImageUrl: track.image || track.album_image || null,
    audioUrl: track.audio,
    downloadUrl: track.audiodownload_allowed ? track.audiodownload : null,
    externalUrl: track.shareurl || track.shorturl || null,
    licenseUrl: track.license_ccurl || null,
    durationMs,
    valence: Number(affective.valence.toFixed(4)),
    energy: Number(affective.energy.toFixed(4)),
    instrumentalness: 1,
    speechiness: 0.01,
    danceability: Number(clamp(affective.energy * 0.65 + affective.valence * 0.2, 0, 1).toFixed(4)),
    tempo: null,
    quadrant: affective.quadrant,
    accent: style.accent,
    palette: style.palette,
    categorySource: "jamendo_musicinfo_waveform",
    analysisSource: "jamendo_metadata_waveform_heuristic",
    analysisConfidence: Number(affective.confidence.toFixed(4)),
    sourceSearch,
    source: "jamendo",
    jamendo: {
      artistId: track.artist_id ?? null,
      albumId: track.album_id ?? null,
      shortUrl: track.shorturl ?? null,
      shareUrl: track.shareurl ?? null,
      audioDownloadAllowed: Boolean(track.audiodownload_allowed),
      contentIdFree: Boolean(track.content_id_free),
      musicInfo: track.musicinfo ?? null,
      affectiveDetails: affective.details,
    },
  };
}

function uniqueByTrackId(tracks) {
  return [...new Map(tracks.map((track) => [track.jamendoId, track])).values()];
}

function pickDiverseTracks(tracks, maxTracks) {
  const sorted = uniqueByTrackId(tracks).sort((a, b) => {
    if (b.analysisConfidence !== a.analysisConfidence) {
      return b.analysisConfidence - a.analysisConfidence;
    }

    return (b.durationMs ?? 0) - (a.durationMs ?? 0);
  });

  const picked = [];
  const artistCounts = new Map();

  for (const track of sorted) {
    const artistKey = track.artist.toLowerCase();
    const artistCount = artistCounts.get(artistKey) ?? 0;
    if (artistCount >= 2) continue;

    picked.push(track);
    artistCounts.set(artistKey, artistCount + 1);
    if (picked.length >= maxTracks) return picked;
  }

  for (const track of sorted) {
    if (picked.some((item) => item.id === track.id)) continue;
    picked.push(track);
    if (picked.length >= maxTracks) return picked;
  }

  return picked;
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

function toCsv(rows) {
  const columns = [
    "id",
    "jamendoId",
    "title",
    "artist",
    "album",
    "quadrant",
    "valence",
    "energy",
    "instrumentalness",
    "speechiness",
    "danceability",
    "durationMs",
    "analysisConfidence",
    "categorySource",
    "audioUrl",
    "downloadUrl",
    "externalUrl",
    "licenseUrl",
    "sourceSearch",
  ];

  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = Array.isArray(value) ? value.join("|") : String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  };

  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\n");
}

async function downloadAudioFiles(tracks, directory) {
  await mkdir(directory, { recursive: true });

  for (const track of tracks) {
    if (!track.downloadUrl) continue;

    const response = await fetch(track.downloadUrl);
    if (!response.ok) {
      console.warn(`Could not download ${track.id} (${response.status}).`);
      continue;
    }

    const filePath = path.join(directory, `${track.id}.mp3`);
    await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
    track.localAudioPath = filePath;
  }
}

async function fetchCandidateTracks(clientId, maxTracks, requireDownloadAllowed) {
  const perQueryLimit = Math.min(numberEnv("JAMENDO_QUERY_LIMIT", MAX_API_LIMIT), MAX_API_LIMIT);
  const maxPages = numberEnv("JAMENDO_MAX_PAGES", 3);
  const targetCandidates = Math.max(maxTracks * 3, maxTracks + 80);
  const candidates = [];
  const seen = new Set();

  for (const search of parseSearchPlan()) {
    for (let page = 0; page < maxPages; page += 1) {
      const payload = await jamendoFetch({
        client_id: clientId,
        format: "json",
        limit: String(perQueryLimit),
        offset: String(page * perQueryLimit),
        audioformat: "mp32",
        audiodlformat: "mp32",
        imagesize: "600",
        include: "musicinfo licenses stats",
        vocalinstrumental: "instrumental",
        type: "single albumtrack",
        groupby: "artist_id",
        ...search.params,
      });

      for (const track of payload.results ?? []) {
        if (!isEligibleTrack(track, requireDownloadAllowed)) continue;
        if (seen.has(track.id)) continue;
        seen.add(track.id);
        candidates.push(normalizeTrack(track, search.label));
      }

      if ((payload.results ?? []).length < perQueryLimit) break;
      if (candidates.length >= targetCandidates) break;
    }

    if (candidates.length >= targetCandidates) break;
  }

  return candidates;
}

async function main() {
  await loadDotEnv();

  const clientId = requiredEnv("JAMENDO_CLIENT_ID");
  const maxTracks = numberEnv("JAMENDO_MAX_TRACKS", DEFAULT_MAX_TRACKS);
  const requireDownloadAllowed = boolEnv("JAMENDO_REQUIRE_DOWNLOAD_ALLOWED", true);
  const downloadAudio = boolEnv("JAMENDO_DOWNLOAD_AUDIO", false);
  const audioDirectory = path.resolve(optionalEnv("JAMENDO_AUDIO_DIR", "data/audio/jamendo"));
  const candidates = await fetchCandidateTracks(clientId, maxTracks, requireDownloadAllowed);
  const tracks = pickDiverseTracks(candidates, maxTracks);

  if (!tracks.length) {
    throw new Error(
      "Jamendo returned no eligible instrumental tracks. Check JAMENDO_CLIENT_ID and discovery filters.",
    );
  }

  if (downloadAudio) {
    await downloadAudioFiles(tracks, audioDirectory);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "jamendo",
    catalogMode: "jamendo-api",
    note:
      "Real instrumental Jamendo tracks. Valence and energy are inferred from Jamendo musicinfo tags, speed and waveform peaks; they are not Spotify Audio Features.",
    filters: {
      maxTracks,
      requireDownloadAllowed,
      vocalinstrumental: "instrumental",
      audioformat: "mp32",
      audiodlformat: "mp32",
      forcedQuadrantBalance: false,
    },
    distribution: distribution(tracks),
    tracks,
  };

  await mkdir(path.resolve("src/data"), { recursive: true });
  await mkdir(path.resolve("data"), { recursive: true });
  await writeFile(path.resolve("src/data/musicCatalog.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(path.resolve("data/jamendo_catalog.csv"), `${toCsv(tracks)}\n`);

  console.log(`Fetched ${candidates.length} eligible Jamendo candidates.`);
  console.log(`Saved ${tracks.length}/${maxTracks} catalog tracks.`);
  console.table(distribution(tracks));

  if (downloadAudio) {
    console.log(`Downloaded allowed MP3 files to ${audioDirectory}.`);
  }

  if (tracks.length < maxTracks) {
    console.warn(
      `Only ${tracks.length}/${maxTracks} tracks were saved. The script does not force artificial quadrant balance.`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
