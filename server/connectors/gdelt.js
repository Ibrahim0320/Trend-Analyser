// server/connectors/gdelt.js
import fs from "fs";

const FASHION_SOURCES = JSON.parse(
  fs.readFileSync(new URL("../fashion_sources.json", import.meta.url))
);

function isFashionSource(url = "") {
  return FASHION_SOURCES.some((d) => url.includes(d));
}

export async function fetchGdelt({ keyword, days = 28 }) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
    keyword
  )}&mode=ArtList&maxrecords=50&format=json&timespan=${days}d`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "ai-trend-dashboard/1.0 (+http://localhost)",
        "Accept": "application/json",
      },
    });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    const arts = j?.articles || [];
    return arts
      .filter((a) => isFashionSource(a.url || ""))
      .map((a) => ({
        source: "news",
        entity_raw: keyword,
        ts_iso: a.seendate
          ? new Date(a.seendate + "Z").toISOString()
          : new Date().toISOString(),
        volume: 1,
        trend: 0,
        fresh: 0.9,
        url: a.url,
        meta: {
          title: a.title,
          source: a.sourceurl,
          lang: a.language,
        },
      }));
  } catch (e) {
    console.warn("[gdelt fetch error]", e?.message || e);
    return [];
  }
}
