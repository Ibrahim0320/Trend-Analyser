// server/connectors/googleTrends.js
import gtrends from "google-trends-api";

const NORDICS = ["SE","NO","DK","FI","IS"];

export function geoForRegion(region) {
  if (region === "FR") return "FR";
  if (region === "Nordics") return NORDICS;
  return ""; // global
}

function slopePct(vals) {
  if (!vals.length) return 0;
  const mid = Math.floor(vals.length/2);
  const first = vals.slice(0, mid);
  const second = vals.slice(mid);
  const avg = a => a.reduce((x,y)=>x+y,0)/Math.max(a.length,1);
  const a = avg(first), b = avg(second);
  return a ? (b-a)/a : 0;
}

/**
 * Combine interestOverTime & relatedQueries into hits.
 */
export async function fetchGoogleTrends({ keyword, geo, days=28 }) {
  const endTime = new Date();
  const startTime = new Date(Date.now() - days*24*3600*1000);

  const geos = Array.isArray(geo) ? geo : (geo ? [geo] : [""]);
  const hits = [];

  // interestOverTime per geo
  for (const g of geos) {
    try {
      const res = await gtrends.interestOverTime({ keyword, startTime, endTime, ...(g?{geo:g}:{}) });
      const data = JSON.parse(res);
      const points = data?.default?.timelineData || [];
      const vals = points.map(p => Number(p.value?.[0] || 0));
      if (!vals.length) continue;

      hits.push({
        source: "trends",
        entity_raw: keyword,
        ts_iso: new Date().toISOString(),
        volume: vals.at(-1) || 0,
        trend: slopePct(vals),
        fresh: 1,
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}${g?`&geo=${g}`:""}`,
        meta: { geo: g || "GLOBAL", points }
      });
    } catch { /* ignore per-geo errors */ }
  }

  // relatedQueries (global or first geo)
  try {
    const rqRes = await gtrends.relatedQueries({ keyword, startTime, endTime, ...(geos[0]?{geo: geos[0]}:{}) });
    const rq = JSON.parse(rqRes)?.default?.rankedList || [];
    const rising = rq.find(x => x?.title?.toLowerCase?.() === "rising")?.rankedKeyword || [];
    const top = rq.find(x => x?.title?.toLowerCase?.() === "top")?.rankedKeyword || [];

    const take = (arr, tag) => {
      for (const r of arr.slice(0, 20)) {
        const v = Number(r.value ?? r.formattedValue ?? 0) || 0;
        hits.push({
          source: "trends",
          entity_raw: r.query,
          ts_iso: new Date().toISOString(),
          volume: v,
          trend: tag === "rising" ? 0.5 : 0.1,
          fresh: 0.8,
          url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(r.query)}`,
          meta: { from: "relatedQueries", tag }
        });
      }
    };
    take(rising, "rising");
    take(top, "top");
  } catch { /* ignore */ }

  return hits;
}
