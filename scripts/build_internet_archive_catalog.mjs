import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ARCHIVE_SEARCH_URL = "https://archive.org/advancedsearch.php";
const ARCHIVE_METADATA_URL = "https://archive.org/metadata";
const MAX_TRACKS = Number(process.env.ARCHIVE_MAX_TRACKS ?? 100);
const MAX_ITEMS_PER_QUERY = Number(process.env.ARCHIVE_ITEMS_PER_QUERY ?? 40);
const MAX_TRACKS_PER_ITEM = Number(process.env.ARCHIVE_TRACKS_PER_ITEM ?? 2);
const METADATA_CONCURRENCY = Number(process.env.ARCHIVE_METADATA_CONCURRENCY ?? 10);
const MIN_SECONDS = Number(process.env.ARCHIVE_MIN_SECONDS ?? 75);
const MAX_SECONDS = Number(process.env.ARCHIVE_MAX_SECONDS ?? 720);
const ARCHIVE_COLLECTION = process.env.ARCHIVE_COLLECTION ?? "netlabels";

const CATEGORY_STYLES = {
  happy: {
    accent: "#22c55e",
    palette: ["#f0fdf4", "#86efac", "#15803d"],
    valence: 0.82,
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
    valence: 0.3,
    energy: 0.26,
  },
};

const SEARCH_PLAN = [
  {
    quadrant: "happy",
    label: "happy-upbeat-instrumental",
    terms:
      "(subject:happy OR subject:upbeat OR subject:positive OR subject:dance OR subject:electronic OR subject:funk OR title:happy)",
  },
  {
    quadrant: "relaxed",
    label: "relaxed-calm-instrumental",
    terms:
      "(subject:relaxing OR subject:relaxation OR subject:ambient OR subject:meditation OR subject:calm OR subject:acoustic OR title:relaxing)",
  },
  {
    quadrant: "tense",
    label: "tense-dark-instrumental",
    terms:
      "(subject:dark OR subject:suspense OR subject:dramatic OR subject:experimental OR subject:industrial OR subject:cinematic OR title:dark)",
  },
  {
    quadrant: "sad_low",
    label: "sad-melancholic-instrumental",
    terms:
      "(subject:sad OR subject:melancholic OR subject:melancholy OR subject:emotional OR subject:piano OR title:sad OR title:melancholy)",
  },
  {
    quadrant: null,
    label: "broad-licensed-instrumental",
    terms: "(subject:instrumental OR title:instrumental OR description:instrumental)",
  },
];

const POSITIVE = [
  "happy",
  "joy",
  "joyful",
  "upbeat",
  "positive",
  "uplifting",
  "funk",
  "dance",
  "pop",
  "summer",
  "bright",
];

const NEGATIVE = [
  "sad",
  "melancholic",
  "melancholy",
  "dark",
  "lonely",
  "horror",
  "suspense",
  "dramatic",
  "industrial",
];

const HIGH_ENERGY = [
  "energetic",
  "upbeat",
  "dance",
  "electronic",
  "rock",
  "industrial",
  "action",
  "experimental",
  "techno",
  "drum",
  "beat",
];

const LOW_ENERGY = [
  "ambient",
  "relaxing",
  "relaxation",
  "meditation",
  "calm",
  "acoustic",
  "piano",
  "soft",
  "downtempo",
];

const BAD_TERMS = [
  "sermon",
  "podcast",
  "lecture",
  "audiobook",
  "interview",
  "news",
  "speech",
  "sample pack",
  "drum samples",
  "drum sample",
];

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : String(value).split(/[;,]/);
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[^;\s]+;/g, " ")
    .toLowerCase();
}

function textBlob(...values) {
  return values
    .flatMap(asArray)
    .map(cleanText)
    .join(" ");
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

function countAny(text, words) {
  return words.reduce((count, word) => count + (text.includes(word) ? 1 : 0), 0);
}

function quadrantFromAxes(valence, energy) {
  if (valence >= 0.5 && energy >= 0.5) return "happy";
  if (valence >= 0.5 && energy < 0.5) return "relaxed";
  if (valence < 0.5 && energy >= 0.5) return "tense";
  return "sad_low";
}

function archiveFileUrl(identifier, fileName) {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${fileName
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

async function archiveSearch(search) {
  const baseQuery = [
    `collection:${ARCHIVE_COLLECTION}`,
    "mediatype:audio",
    "licenseurl:*",
    "(subject:instrumental OR title:instrumental OR description:instrumental)",
    search.terms,
  ].join(" AND ");

  const params = new URLSearchParams({
    q: baseQuery,
    fl: "identifier,title,creator,licenseurl,subject,downloads",
    rows: String(MAX_ITEMS_PER_QUERY),
    output: "json",
    sort: "downloads desc",
  });

  const response = await fetch(`${ARCHIVE_SEARCH_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Internet Archive search failed (${response.status}).`);
  }

  const payload = await response.json();
  return (payload.response?.docs ?? []).map((doc) => ({
    ...doc,
    sourceQuadrant: search.quadrant,
    sourceSearch: search.label,
  }));
}

async function archiveMetadata(identifier) {
  const response = await fetch(`${ARCHIVE_METADATA_URL}/${encodeURIComponent(identifier)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Internet Archive metadata failed for ${identifier} (${response.status}).`);
  }

  return response.json();
}

function parseLength(file) {
  const value = Number(file.length ?? file.track_length ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function scoreFile(file) {
  const format = cleanText(file.format);
  const name = cleanText(file.name);
  let score = 0;

  if (format.includes("vbr mp3")) score += 8;
  if (format.includes("mp3")) score += 6;
  if (file.source === "original") score += 4;
  if (name.endsWith(".mp3")) score += 3;
  if (format.includes("ogg")) score += 1;
  if (name.includes("_64kb")) score -= 8;
  if (name.includes("sample")) score -= 8;
  if (name.includes("cover")) score -= 4;

  return score;
}

function pickAudioFiles(metadata) {
  return (metadata.files ?? [])
    .filter((file) => {
      const name = cleanText(file.name);
      const format = cleanText(file.format);
      const length = parseLength(file);
      return (
        (name.endsWith(".mp3") || format.includes("mp3")) &&
        length >= MIN_SECONDS &&
        length <= MAX_SECONDS &&
        !name.includes("metadata") &&
        !name.includes("sample") &&
        !name.includes("64kb")
      );
    })
    .sort((a, b) => scoreFile(b) - scoreFile(a))
    .slice(0, MAX_TRACKS_PER_ITEM);
}

function estimateAxes(doc, metadata, file) {
  const source = doc.sourceQuadrant ? CATEGORY_STYLES[doc.sourceQuadrant] : null;
  const blob = textBlob(
    doc.title,
    doc.subject,
    metadata.metadata?.title,
    metadata.metadata?.subject,
    metadata.metadata?.description,
    file.title,
    file.genre,
    file.name,
  );

  const positive = countAny(blob, POSITIVE);
  const negative = countAny(blob, NEGATIVE);
  const high = countAny(blob, HIGH_ENERGY);
  const low = countAny(blob, LOW_ENERGY);

  const valenceEvidence = clamp(0.5 + positive * 0.09 - negative * 0.11, 0.08, 0.92);
  const energyEvidence = clamp(0.5 + high * 0.08 - low * 0.1, 0.08, 0.92);
  const valence = source
    ? clamp(source.valence * 0.64 + valenceEvidence * 0.36, 0.05, 0.95)
    : valenceEvidence;
  const energy = source
    ? clamp(source.energy * 0.64 + energyEvidence * 0.36, 0.05, 0.95)
    : energyEvidence;
  const quadrant = quadrantFromAxes(valence, energy);

  return {
    valence,
    energy,
    quadrant,
    confidence: clamp(0.38 + (positive + negative + high + low) * 0.06 + (source ? 0.2 : 0), 0.2, 0.9),
    tags: {
      positive,
      negative,
      highEnergy: high,
      lowEnergy: low,
      sourceQuadrant: doc.sourceQuadrant,
      text: blob.slice(0, 400),
    },
  };
}

function normalizeTrack(doc, metadata, file, fileIndex) {
  const blob = textBlob(doc.title, doc.subject, metadata.metadata?.description, file.title, file.name);
  if (!hasAny(blob, ["instrumental"]) || hasAny(blob, BAD_TERMS)) return null;

  const axes = estimateAxes(doc, metadata, file);
  const style = CATEGORY_STYLES[axes.quadrant];
  const identifier = metadata.metadata?.identifier ?? doc.identifier;
  const fileStem = file.name.replace(/\.[^.]+$/, "");
  const title = file.title || fileStem.replaceAll("_", " ").replaceAll("-", " ");
  const artist = file.artist || metadata.metadata?.creator || doc.creator || "Internet Archive artist";
  const licenseUrl = metadata.metadata?.licenseurl || doc.licenseurl || null;

  if (!licenseUrl) return null;

  return {
    id: `archive-${identifier}-${fileIndex}-${file.name}`.replace(/[^A-Za-z0-9_-]+/g, "-"),
    archiveIdentifier: identifier,
    archiveFile: file.name,
    jamendoId: null,
    spotifyId: null,
    spotifyUri: null,
    title,
    artist: Array.isArray(artist) ? artist.join(", ") : String(artist),
    album: metadata.metadata?.title || doc.title || "",
    albumImageUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    audioUrl: archiveFileUrl(identifier, file.name),
    downloadUrl: archiveFileUrl(identifier, file.name),
    externalUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    licenseUrl,
    durationMs: Math.round(parseLength(file) * 1000),
    valence: Number(axes.valence.toFixed(4)),
    energy: Number(axes.energy.toFixed(4)),
    instrumentalness: 0.9,
    speechiness: 0.04,
    danceability: Number(clamp(axes.energy * 0.68 + axes.valence * 0.18, 0, 1).toFixed(4)),
    tempo: null,
    quadrant: axes.quadrant,
    accent: style.accent,
    palette: style.palette,
    categorySource: "internet_archive_metadata_query",
    analysisSource: "internet_archive_metadata_query_heuristic",
    analysisConfidence: Number(axes.confidence.toFixed(4)),
    sourceSearch: doc.sourceSearch,
    source: "internet_archive",
    internetArchive: {
      identifier,
      fileName: file.name,
      format: file.format ?? null,
      source: file.source ?? null,
      licenseUrl,
      downloads: doc.downloads ?? null,
      subject: metadata.metadata?.subject ?? doc.subject ?? null,
      affectiveDetails: axes.tags,
    },
  };
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

function toCsv(rows) {
  const columns = [
    "id",
    "archiveIdentifier",
    "archiveFile",
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

async function main() {
  const groups = [];
  const seenIdentifiers = new Set();

  for (const search of SEARCH_PLAN) {
    console.log(`Searching ${search.label}...`);
    const results = await archiveSearch(search);
    console.log(`  ${results.length} candidate items`);
    const group = [];
    for (const doc of results) {
      if (seenIdentifiers.has(doc.identifier)) continue;
      seenIdentifiers.add(doc.identifier);
      group.push(doc);
    }
    groups.push(group);
  }

  const docs = interleave(groups);

  const tracks = [];
  for (let index = 0; index < docs.length && tracks.length < MAX_TRACKS; index += METADATA_CONCURRENCY) {
    console.log(`Inspecting metadata ${index + 1}-${Math.min(index + METADATA_CONCURRENCY, docs.length)} of ${docs.length}...`);
    const batch = docs.slice(index, index + METADATA_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (doc) => {
        const metadata = await archiveMetadata(doc.identifier);
        return { doc, metadata };
      }),
    );

    for (const result of results) {
      if (tracks.length >= MAX_TRACKS) break;
      if (result.status === "rejected") {
        console.warn(result.reason?.message ?? "Internet Archive metadata request failed.");
        continue;
      }

      const { doc, metadata } = result.value;
      const files = pickAudioFiles(metadata);
      files.forEach((file, fileIndex) => {
        if (tracks.length >= MAX_TRACKS) return;
        const track = normalizeTrack(doc, metadata, file, fileIndex + 1);
        if (track) tracks.push(track);
      });
    }
  }

  if (!tracks.length) {
    throw new Error("Internet Archive search returned no eligible instrumental audio tracks.");
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "internet_archive",
    catalogMode: "internet-archive-api",
    note:
      "Real licensed Internet Archive instrumental tracks. Valence and energy are inferred from archive subjects, titles, query context and file metadata; they are not Spotify Audio Features.",
    filters: {
      maxTracks: MAX_TRACKS,
      licenseUrlRequired: true,
      instrumentalTextRequired: true,
      minSeconds: MIN_SECONDS,
      maxSeconds: MAX_SECONDS,
      collection: ARCHIVE_COLLECTION,
      forcedQuadrantBalance: false,
    },
    distribution: distribution(tracks),
    tracks,
  };

  await mkdir(path.resolve("src/data"), { recursive: true });
  await mkdir(path.resolve("data"), { recursive: true });
  await writeFile(path.resolve("src/data/musicCatalog.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(path.resolve("data/internet_archive_catalog.csv"), `${toCsv(tracks)}\n`);

  console.log(`Searched ${docs.length} Internet Archive items.`);
  console.log(`Saved ${tracks.length}/${MAX_TRACKS} catalog tracks.`);
  console.table(distribution(tracks));

  if (tracks.length < MAX_TRACKS) {
    console.warn(`Only ${tracks.length}/${MAX_TRACKS} tracks were saved.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
