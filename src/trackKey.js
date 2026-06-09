// Shared between the browser app and the lookup build script (node).
function normalizePart(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(
      /\s*-\s*(remaster(ed)?|single version|radio edit|album version|live|mono|stereo|deluxe|bonus track|sped up|slowed).*/g,
      "",
    )
    .replace(/\b(feat|ft|featuring|with)\b\.?.*$/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function trackNameKey(artist, title) {
  const normalizedArtist = normalizePart(artist);
  const normalizedTitle = normalizePart(title);
  if (!normalizedArtist || !normalizedTitle) return null;
  return `${normalizedArtist}|${normalizedTitle}`;
}

export function artistNameKey(artist) {
  return normalizePart(artist) || null;
}
