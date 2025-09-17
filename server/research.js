// server/research.js
import dotenv from "dotenv";
dotenv.config();

import { Database } from "./sqlite.js";
import { fetchGoogleTrends, geoForRegion } from "./connectors/googleTrends.js";
import { fetchYouTube } from "./connectors/youtube.js";
import { fetchGdelt } from "./connectors/gdelt.js";
import { fetchReddit } from "./connectors/reddit.js";

/* Mapping & normalization */
const COLORS = ["black","white","beige","navy","olive","cream","red","brown","gray","green"];
const ITEMS  = ["dress","blazer","trench","trenchcoat","loafer","loafers","knit","cargo","tote","denim","skirt","sneaker"];
const STOP   = new Set(["designer","brand","fashion","style","outfit"]);

function mapEntity(str) {
  const k = (str||"").toLowerCase().trim();
  if (k.startsWith("#")) return { mapped: k, type: "hashtag" };
  if (STOP.has(k)) return { mapped: null, type: "topic" };
  for (const c of COLORS) if (k.includes(c)) return { mapped: c, type: "color" };
  for (const it of ITEMS)  if (k.includes(it)) return { mapped: it, type: "item" };
  return { mapped: k, type: "topic" };
}

/* Scoring */
function scoreHit({ source, volume = 0, trend = 0, fresh = 0 }) {
  const weights = {
    news: 1.0,       // Vogue, BoF, etc.
    trends: 0.8,     // Google search interest
    creator: 0.6,    // YouTube/TikTok with >50k views
    reddit: 0.2,     // community chatter (low weight)
  };
  const w = weights[source] ?? 0.5;
  const v = Math.log10(Math.max(volume, 1));
  const t = Math.tanh(trend * 3);
  const f = fresh ?? 0;
  return v + 0.7 * t + 0.3 * w + 0.3 * f;
}

function bulletsFromLeaders(leaders, n=6) {
  return leaders.slice(0,n).map(l => {
    const pct = l.trend ? `${Math.round(l.trend*100)}%` : "";
    const meta = [pct && `trend ${pct}`, l.volume && `vol ${Math.round(l.volume)}`].filter(Boolean).join(", ");
    return `• ${l.entity} – ${l.type}${meta ? ` (${meta})` : ""}`;
  });
}

/* Persist one normalized signal row */
async function insertSignal(db, h, fallbackKeyword) {
  const day = (h.ts_iso || new Date().toISOString()).slice(0,10);
  const keyword = (h.entity_raw || fallbackKeyword || "").toLowerCase().trim();
  if (!keyword) return;
  const source = h.source === "gdelt" ? "news" : h.source;
  let value = 1;
  if (source === "youtube") value = Number(h.volume||0);
  else if (source === "trends") value = Number(h.volume||0);
  else if (source === "reddit") value = 1 + Number(h.meta?.ups||0) + Number(h.meta?.numComments||0);
  else value = 1;

  await db.run(
    `INSERT INTO signals(date, keyword, source, value, meta_json) VALUES (?,?,?,?,?)`,
    [day, keyword, source, value, JSON.stringify(h.meta || {})]
  );
}

export async function runResearch({ region="Nordics", keywords=[], window_days=28 } = {}) {
  const db = await Database.get();
  const now = new Date().toISOString();

  if (!Array.isArray(keywords) || keywords.length === 0) {
    keywords = ["trenchcoat","loafers","quiet luxury","beige","red shoes"];
  }

  const geo = geoForRegion(region);

  const allHits = [];
  const sourceCounts = { youtube: 0, trends: 0, reddit: 0, gdelt: 0 };

  for (const kw of keywords) {
    const [gt, yt, gd, rd] = await Promise.all([
      fetchGoogleTrends({ keyword: kw, geo, days: window_days }).catch(()=>[]),
      fetchYouTube({ keyword: kw, days: Math.min(window_days, 14), regionCode: Array.isArray(geo)?undefined:geo || undefined }).catch(()=>[]),
      fetchGdelt({ keyword: kw, days: window_days }).catch(()=>[]),
      fetchReddit({ keyword: kw, days: Math.min(window_days, 14) }).catch(()=>[])
    ]);

    for (const h of [...gt, ...yt, ...gd, ...rd]) {
      await insertSignal(db, h, kw);
    }

    const pack = [...gt, ...yt, ...gd, ...rd].map(h => {
      const raw = h.entity_raw ?? kw;
      const { mapped, type } = mapEntity(raw);
      const score = scoreHit(h);
      return { ...h, entity_mapped: mapped, type, score };
    });

    allHits.push(...pack);
    sourceCounts.trends += gt.length;
    sourceCounts.youtube += yt.length;
    sourceCounts.gdelt  += gd.length;
    sourceCounts.reddit += rd.length;
  }

  // Aggregate by entity
  const agg = new Map();
  for (const h of allHits) {
    if (!h.entity_mapped) continue;
    const k = `${h.entity_mapped}|${h.type}`;
    if (!agg.has(k)) agg.set(k, { entity: h.entity_mapped, type: h.type, volume: 0, trend: 0, fresh: 0, score: 0, urls: new Set() });
    const a = agg.get(k);
    a.volume += h.volume || 0;
    a.trend  += h.trend  || 0;
    a.fresh   = Math.max(a.fresh, h.fresh || 0);
    a.score  += h.score  || 0;
    if (h.url && a.urls.size < 6) a.urls.add(h.url);
  }

  let leaders = Array.from(agg.values()).map(a => ({ ...a, urls: Array.from(a.urls) }))
                   .sort((x,y)=>y.score - x.score);

  if (leaders.length < 3) {
    const fillers = keywords.map(k => {
      const m = mapEntity(k);
      if (!m.mapped) return null;
      return { entity: m.mapped, type: m.type, volume: 0, trend: 0, fresh: 0, score: 0.1, urls: [] };
    }).filter(Boolean);
    leaders = [...leaders, ...fillers].slice(0, 6);
  }

  const rising = bulletsFromLeaders(leaders, 6);

  const whyMatters = "External signals show momentum across search, video, and news. Items/colors reflect transitional styling and neutrals; YouTube velocity suggests near-term creator uptake.";
  const aheadOfCurve = [
    "Prototype 3 looks and brief creators this week; measure save/comment lift vs baseline.",
    "Pre-book core neutrals; test small red accents to validate before scaling.",
    "Set a watchlist alert when the 7d trend > 1.3× across two sources."
  ];

  const runRes = await db.run(
    `INSERT INTO research_runs(region, keywords_json, content_json, created_at, status) VALUES(?,?,?,?,?)`,
    [region, JSON.stringify(keywords), JSON.stringify({ rising, whyMatters, aheadOfCurve, sourceCounts }), now, "done"]
  );
  const run_id = runRes.lastID;

  const insertHit = await db.prepare(`INSERT INTO research_hits(run_id, source, entity_raw, entity_mapped, type, ts_iso, volume, trend, fresh, weight, score, url, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const h of allHits) {
    await insertHit.run([
      run_id, h.source, h.entity_raw || "", h.entity_mapped || "", h.type || "topic", h.ts_iso || now,
      h.volume||0, h.trend||0, h.fresh||0, h.weight||null, h.score||0,
      h.url||null, JSON.stringify(h.meta||{})
    ]);
  }
  await insertHit.finalize();

  console.log("[research] sourceCounts", sourceCounts);
  console.log("[research] leaders(top3)", leaders.slice(0,3));
  console.log("[research] rising", rising);

  return {
    created_at: now,
    region,
    keywords,
    rising,
    whyMatters,
    aheadOfCurve,
    leaders: leaders.slice(0,20),
    citations: leaders.slice(0,6).flatMap(l => l.urls.map(u => ({ entity: l.entity, url: u }))),
    sourceCounts
  };
}

export async function latestResearch(region="Nordics") {
  const db = await Database.get();
  const run = await db.get(`SELECT rowid as id, * FROM research_runs WHERE region = ? ORDER BY created_at DESC LIMIT 1`, [region]);
  if (!run) return null;
  const content = JSON.parse(run.content_json || "{}");
  const hits = await db.all(`SELECT * FROM research_hits WHERE run_id = ? ORDER BY score DESC LIMIT 100`, [run.id]);
  return { region, created_at: run.created_at, ...content, hits };
}
