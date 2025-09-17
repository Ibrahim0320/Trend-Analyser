// server/themes.js
import { Database } from "./sqlite.js";

function isoWeekStr(d) {
  const date = new Date(d);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(),0,4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay()+6)%7)) / 7);
  const y = target.getUTCFullYear();
  return `${y}-W${String(week).padStart(2,'0')}`;
}

function sigmoid(x){ return 1/(1+Math.exp(-x)); }
const SRC_WEIGHT = { search:0.35, news:0.15, social:0.30, video:0.20 };

function sourceAlias(src) {
  if (src === "trends") return "search";
  if (src === "gdelt" || src === "news")  return "news";
  if (src === "youtube")return "video";
  if (src === "reddit") return "social";
  return src;
}

export async function computeThemes({ region="Nordics", week=null, lookbackDays=56 } = {}) {
  const db = await Database.get();
  const since = new Date(Date.now() - lookbackDays*24*3600*1000).toISOString().slice(0,10);

  const rows = await db.all(`SELECT date, keyword, source, value FROM signals WHERE date >= ?`, [since]);
  if (!rows.length) return [];

  // bucket by week per keyword & source
  const byKey = new Map(); // theme|week -> {theme, week, src:{search,news,social,video}}
  for (const r of rows) {
    const w = isoWeekStr(r.date);
    const theme = (r.keyword || "").toLowerCase().trim();
    if (!theme) continue;
    const src = sourceAlias(r.source);
    const k = `${theme}|${w}`;
    if (!byKey.has(k)) byKey.set(k, { theme, week: w, src: {search:0, news:0, social:0, video:0} });
    byKey.get(k).src[src] = (byKey.get(k).src[src] || 0) + Number(r.value||0);
  }

  // build series by theme
  const seriesByTheme = new Map();
  for (const v of byKey.values()) {
    if (!seriesByTheme.has(v.theme)) seriesByTheme.set(v.theme, []);
    seriesByTheme.get(v.theme).push(v);
  }
  for (const arr of seriesByTheme.values()) arr.sort((a,b)=>a.week.localeCompare(b.week));

  const out = [];
  for (const [theme, arr] of seriesByTheme.entries()) {
    const trimmed = arr.slice(-8); // last 8 weeks
    if (!trimmed.length) continue;

    const weeks = trimmed.map(x=>x.week);
    const latestWeek = week || weeks.at(-1);
    const srcs = ["search","news","social","video"];

    // stats per source
    const stats = {};
    for (const s of srcs) {
      const vals = trimmed.map(x=>Number(x.src[s]||0));
      const mean = vals.reduce((a,b)=>a+b,0)/Math.max(vals.length,1);
      const sd = Math.sqrt(vals.reduce((a,b)=>a+(b-mean)*(b-mean),0)/Math.max(vals.length,1)) || 0;
      stats[s] = { mean, sd, vals };
    }

    const last = trimmed.find(x=>x.week===latestWeek) || trimmed.at(-1);
    if (!last) continue;

    // weighted z for current week
    const zBySrc = {};
    let zsum = 0;
    for (const s of srcs) {
      const { mean, sd } = stats[s];
      const val = Number(last.src[s]||0);
      const z = sd ? (val-mean)/sd : 0;
      zBySrc[s] = z;
      zsum += (SRC_WEIGHT[s] || 0) * z;
    }
    const heat = 100 * sigmoid(zsum);

    // momentum and simple 2w projection (extrapolate weighted z)
    const zsumAt = (i) => {
      const x = trimmed[i];
      let s = 0;
      for (const src of srcs) {
        const { mean, sd } = stats[src];
        const v = Number(x.src[src]||0);
        const z = sd ? (v-mean)/sd : 0;
        s += (SRC_WEIGHT[src]||0)*z;
      }
      return s;
    };

    const len = trimmed.length;
    const prevZ = len>=2 ? zsumAt(len-2) : zsum;
    const currZ = zsumAt(len-1);
    const momentum = Math.tanh(currZ - prevZ); // -1..1

    // Projection (2 weeks): z_next = curr + (curr - prev); heat_next = sigmoid(z_next)*100
    const projZ = currZ + (currZ - prevZ);
    const forecast_heat = 100 * sigmoid(projZ);

    // Confidence: based on history length & z volatility (lower volatility => higher confidence)
    const zHist = trimmed.map((_,i)=>zsumAt(i));
    const meanZ = zHist.reduce((a,b)=>a+b,0)/zHist.length;
    const sdZ = Math.sqrt(zHist.reduce((a,b)=>a+(b-meanZ)*(b-meanZ),0)/Math.max(zHist.length,1)) || 0;
    const confLen = Math.min(1, zHist.length / 6);           // up to 1 with 6+ points
    const confVol = 1 / (1 + sdZ);                            // 0..1 (smaller sd => closer to 1)
    const confidence = Math.max(0.1, 0.6*confLen + 0.4*confVol); // weighted

    // top links from recent evidence
    const since28 = new Date(Date.now()-28*24*3600*1000).toISOString();
    const links = await db.all(
      `SELECT url FROM research_hits WHERE entity_mapped = ? AND url IS NOT NULL AND ts_iso >= ? ORDER BY score DESC LIMIT 5`,
      [theme, since28]
    );
    const topLinks = links.map(x=>x.url);

    const awa = heat >= 70 && momentum > 0 ? "ACT" : (heat >= 40 ? "WATCH" : "AVOID");

    out.push({
      theme, week: latestWeek,
      heat, momentum,
      forecast_heat, confidence,
      act_watch_avoid: awa,
      sources: [
        { source:"video",  z: zBySrc.video,  weight: SRC_WEIGHT.video  },
        { source:"search", z: zBySrc.search, weight: SRC_WEIGHT.search },
        { source:"news",   z: zBySrc.news,   weight: SRC_WEIGHT.news   },
        { source:"social", z: zBySrc.social, weight: SRC_WEIGHT.social },
      ],
      links: topLinks
    });
  }

  // persist weekly snapshot
  const now = new Date().toISOString();
  const insert = await (await Database.get()).prepare(
    `INSERT INTO themes(week, theme, heat, momentum, sources_json, top_links_json, act_watch_avoid, created_at)
     VALUES(?,?,?,?,?,?,?,?)`
  );
  for (const t of out) {
    await insert.run([
      t.week, t.theme, t.heat, t.momentum,
      JSON.stringify(t.sources), JSON.stringify(t.links), t.act_watch_avoid, now
    ]);
  }
  await insert.finalize();

  return out.sort((a,b)=>b.heat-a.heat);
}

export async function getTopThemes({ region="Nordics", week=null, limit=10 } = {}) {
  const db = await Database.get();
  let targetWeek = week;
  if (!targetWeek) {
    const row = await db.get(`SELECT week FROM themes ORDER BY week DESC LIMIT 1`);
    targetWeek = row?.week || null;
  }
  if (!targetWeek) return [];
  const rows = await db.all(
    `SELECT * FROM themes WHERE week = ? ORDER BY heat DESC LIMIT ?`,
    [targetWeek, Number(limit)]
  );
  // NOTE: old rows don’t have forecast/confidence stored; we recompute lightweight here if missing
  return rows.map(r => ({
    theme: r.theme,
    week: r.week,
    heat: r.heat,
    momentum: r.momentum,
    act_watch_avoid: r.act_watch_avoid,
    sources: JSON.parse(r.sources_json || "[]"),
    links: JSON.parse(r.top_links_json || "[]"),
    // placeholders; client tolerates absence
    forecast_heat: undefined,
    confidence: undefined
  }));
}

export async function getThemeOne({ theme, weeks=8 }) {
  const db = await Database.get();
  const since = new Date(Date.now()-weeks*7*24*3600*1000).toISOString().slice(0,10);
  const rows = await db.all(
    `SELECT date, source, value FROM signals WHERE keyword = ? AND date >= ? ORDER BY date ASC`,
    [theme, since]
  );
  return rows;
}
