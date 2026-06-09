import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { artistNameKey, trackNameKey } from "../src/trackKey.js";

const RAW_DATASET_PATH = "data/spotify_tracks_dataset.csv";
const OUTPUT_JSON_PATH = "public/feature-lookup.json";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows
    .filter((items) => items.length === headers.length)
    .map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index]])));
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function main() {
  const rows = parseCsv(await readFile(RAW_DATASET_PATH, "utf8"));
  const ids = {};
  const names = {};
  const artistSums = new Map();
  let skipped = 0;

  for (const row of rows) {
    const trackId = row.track_id;
    const valence = Number(row.valence);
    const energy = Number(row.energy);
    const instrumentalness = Number(row.instrumentalness);

    if (!trackId || !Number.isFinite(valence) || !Number.isFinite(energy)) {
      skipped += 1;
      continue;
    }

    const features = [
      round2(valence),
      round2(energy),
      Number.isFinite(instrumentalness) ? round2(instrumentalness) : 0,
    ];

    ids[trackId] ??= features;

    // Same recording is published under many Spotify IDs (album, single,
    // deluxe, regional re-releases), so also key by normalized artist+title.
    const primaryArtist = String(row.artists ?? "").split(";")[0];
    const nameKey = trackNameKey(primaryArtist, row.track_name);
    if (nameKey) names[nameKey] ??= features;

    const artistKey = artistNameKey(primaryArtist);
    if (artistKey) {
      const sums = artistSums.get(artistKey) ?? [0, 0, 0, 0];
      sums[0] += features[0];
      sums[1] += features[1];
      sums[2] += features[2];
      sums[3] += 1;
      artistSums.set(artistKey, sums);
    }
  }

  // Tier-3 fallback: average mood profile per artist for tracks the dataset
  // does not contain individually.
  const artists = {};
  for (const [artistKey, [valenceSum, energySum, instrumentalnessSum, count]] of artistSums) {
    artists[artistKey] = [
      round2(valenceSum / count),
      round2(energySum / count),
      round2(instrumentalnessSum / count),
    ];
  }

  await mkdir(path.dirname(OUTPUT_JSON_PATH), { recursive: true });
  await writeFile(OUTPUT_JSON_PATH, JSON.stringify({ ids, names, artists }));
  console.log(
    `Wrote ${Object.keys(ids).length} ids, ${Object.keys(names).length} name keys, ` +
      `${Object.keys(artists).length} artist keys to ${OUTPUT_JSON_PATH} (${skipped} rows skipped).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
