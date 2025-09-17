import dayjs from "dayjs";
import isoWeekPlugin from "dayjs/plugin/isoWeek.js";
import { Database } from "./sqlite.js";

dayjs.extend(isoWeekPlugin);

const COLORS = ["black","white","beige","navy","olive","cream","red","brown","gray","green"];
const ITEMS = ["dress","blazer","trench","trenchcoat","loafer","loafers","knit","cargo","tote","denim","skirt","sneaker"];

function normalizeHashtags(s) {
  if (!s) return [];
  return s.split("|").map(x => x.trim().toLowerCase());
}
function extractEntities(textLower, hashtags) {
  const entities = [];
  for (const h of hashtags) {
    if (!h.startsWith("#")) entities.push("#" + h.replace(/^#/, ""));
    else entities.push(h);
  }
  const words = new Set(textLower.split(/[^a-z0-9#]+/g));
  for (const c of COLORS) if (words.has(c)) entities.push(c);
  for (const it of ITEMS) if (words.has(it)) entities.push(it);
  return Array.from(new Set(entities));
}
function regionFromCountry(cc) {
  const nordics = new Set(["SE","NO","DK","FI","IS"]);
  if (nordics.has((cc||"").toUpperCase())) return "Nordics";
  if ((cc||"").toUpperCase() === "FR") return "FR";
  return "Other";
}
function weekISO(ts) {
  const d = dayjs(ts);
  return `${d.year()}-W${String(d.isoWeek()).padStart(2,"0")}`;
}

export async function computeTrendsForUpload(rows) {
  const db = await Database.get();
  const insertPost = await db.prepare(`INSERT INTO social_posts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const entityRows = [];

  for (const r of rows) {
    const engagement = (Number(r.like_count)||0) + (Number(r.comment_count)||0) + (Number(r.share_count)||0) + (Number(r.save_count)||0);
    const eng_rate = engagement / Math.max(Number(r.author_followers)||1, 1);
    const hashtags = normalizeHashtags(r.hashtags);
    const textLower = (r.text || "").toLowerCase();
    const ents = extractEntities(textLower, hashtags);
    const wk = weekISO(r.ts_iso);
    const region = regionFromCountry(r.geo_country);

    await insertPost.run([
      r.platform, r.post_id, r.post_url, r.author, Number(r.author_followers)||0,
      r.ts_iso, r.language, r.text, r.hashtags,
      Number(r.like_count)||0, Number(r.comment_count)||0, Number(r.share_count)||0, Number(r.save_count)||0,
      Number(r.video_views)||0, r.geo_country
    ]);

    for (const e of ents) {
      entityRows.push({
        entity: e,
        type: e.startsWith("#") ? "hashtag" : (COLORS.includes(e) ? "color" : "item"),
        week: wk,
        region,
        engagement,
        eng_rate
      });
    }
  }
  await insertPost.finalize();

  // Aggregate per (entity,type,week,region)
  const key = (o) => `${o.entity}|${o.type}|${o.week}|${o.region}`;
  const groups = new Map();
  for (const row of entityRows) {
    const k = key(row);
    if (!groups.has(k)) groups.set(k, { ...row, posts: 0, eng_sum: 0, eng_rates: [] });
    const g = groups.get(k);
    g.posts += 1;
    g.eng_sum += row.engagement;
    g.eng_rates.push(row.eng_rate);
  }
  const byKey = Array.from(groups.values()).map(g => ({
    entity: g.entity, type: g.type, week: g.week, region: g.region,
    posts: g.posts, eng_sum: g.eng_sum,
    eng_rate_median: g.eng_rates.sort((a,b)=>a-b)[Math.floor(g.eng_rates.length/2)]
  }));

  // Build history index for z/minmax
  const dbRows = await db.all(`SELECT entity, type, week, region, posts, eng_sum, eng_rate_median FROM entities`);
  const all = [...dbRows, ...byKey];
  const index = new Map();
  for (const r of all) {
    const k = `${r.entity}|${r.type}|${r.region}`;
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(r);
  }
  function zOrMinMax(series, value) {
    if (series.length < 8) {
      const vals = series.concat([value]);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      if (max === min) return 0;
      return (value - min) / (max - min);
    }
    const mean = series.reduce((a,b)=>a+b,0) / series.length;
    const std = Math.sqrt(series.reduce((s,x)=>s+(x-mean)*(x-mean),0)/series.length) || 1;
    return (value - mean) / std;
  }

  // UPSERT entities (replace for same entity/type/week/region)
  const upsert = await db.prepare(`
    INSERT INTO entities (entity, type, week, region, posts, eng_sum, eng_rate_median, score, growth)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(entity, type, week, region)
    DO UPDATE SET
      posts = excluded.posts,
      eng_sum = excluded.eng_sum,
      eng_rate_median = excluded.eng_rate_median,
      score = excluded.score,
      growth = excluded.growth
  `);

  for (const r of byKey) {
    const hist = (index.get(`${r.entity}|${r.type}|${r.region}`) || []).filter(x => x.week !== r.week);
    const weeksSorted = hist.map(x=>x.week).sort();
    const lastWeek = weeksSorted[weeksSorted.length-1];
    const prev = hist.find(x=>x.week === lastWeek);

    const volW = r.posts;
    const engW = r.eng_sum;
    const velW = r.eng_rate_median;

    const vols = hist.map(x=>x.posts);
    const engs = hist.map(x=>x.eng_sum);
    const vels = hist.map(x=>x.eng_rate_median);

    const score = zOrMinMax(vols, volW) + 0.5*zOrMinMax(engs, engW) + 0.5*zOrMinMax(vels, velW) + ((prev && volW > 1.3*prev.posts) ? 1 : 0);
    const growth = (prev ? volW / Math.max(prev.posts, 1) : null);

    await upsert.run([r.entity, r.type, r.week, r.region, r.posts, r.eng_sum, r.eng_rate_median, score, growth]);
  }
  await upsert.finalize();
}

export async function getTopEntities(type, region, week, limit=20) {
  const db = await Database.get();
  const params = [type, region];
  let where = `WHERE type = ? AND region = ?`;
  if (week) { where += ` AND week = ?`; params.push(week); }
  const rows = await db.all(`SELECT * FROM entities ${where} ORDER BY score DESC LIMIT ?`, [...params, limit]);
  return rows;
}

export async function getTimeSeries(entity, type, region, weeks=8) {
  const db = await Database.get();
  const rows = await db.all(`SELECT * FROM entities WHERE entity = ? AND type = ? AND region = ? ORDER BY week DESC LIMIT ?`, [entity, type, region, weeks]);
  return rows.reverse();
}

export async function getCooccur(left, right, region, week) {
  const db = await Database.get();
  const rows = await db.all(`SELECT * FROM social_posts`);
  const inRegion = rows.filter(r => {
    const cc = (r.geo_country||"").toUpperCase();
    return (region === "Nordics" && ["SE","NO","DK","FI","IS"].includes(cc)) ||
           (region === "FR" && cc === "FR");
  });
  const filtered = inRegion.filter(r => !week || weekISO(r.ts_iso) === week);
  const dict = {
    colors: new Set(["black","white","beige","navy","olive","cream","red","brown","gray","green"]),
    items:  new Set(["dress","blazer","trench","trenchcoat","loafer","loafers","knit","cargo","tote","denim","skirt","sneaker"])
  };
  const counts = {};
  for (const r of filtered) {
    const words = (r.text||"").toLowerCase().split(/[^a-z0-9#]+/g);
    const lefts = new Set(words.filter(w => dict[left]?.has(w)));
    const rights = new Set(words.filter(w => dict[right]?.has(w)));
    for (const l of lefts) for (const rt of rights) {
      const k = `${l}|${rt}`;
      counts[k] = (counts[k]||0) + 1;
    }
  }
  return Object.entries(counts).map(([k,v])=>{
    const [l,r] = k.split("|");
    return { left: l, right: r, count: v };
  });
}

export async function getTopCreators(entity, region, week) {
  const db = await Database.get();
  const posts = await db.all(`SELECT * FROM social_posts`);
  const match = posts.filter(p => {
    const wk = weekISO(p.ts_iso);
    const inRegion = (region === "Nordics" && ["SE","NO","DK","FI","IS"].includes((p.geo_country||"").toUpperCase())) ||
                     (region === "FR" && (p.geo_country||"").toUpperCase()==="FR");
    const text = ((p.text||"") + " " + (p.hashtags||"")).toLowerCase();
    return inRegion && (!week || wk === week) && text.includes(entity.replace("#","").toLowerCase());
  });
  const stats = new Map();
  for (const m of match) {
    const engagement = (m.like_count||0)+(m.comment_count||0)+(m.share_count||0)+(m.save_count||0);
    const eng_rate = engagement / Math.max(m.author_followers||1,1);
    if (!stats.has(m.author)) stats.set(m.author, { author: m.author, posts: 0, eng_rates: [] });
    const s = stats.get(m.author);
    s.posts += 1;
    s.eng_rates.push(eng_rate);
  }
  return Array.from(stats.values()).map(s => ({
    author: s.author,
    posts: s.posts,
    avg_eng_rate: s.eng_rates.reduce((a,b)=>a+b,0)/s.eng_rates.length
  })).sort((a,b)=>b.avg_eng_rate - a.avg_eng_rate).slice(0,20);
}

export async function generateSummary(region, week) {
  const db = await Database.get();
  const leaders = await getTopEntities("hashtag", region, week, 10);
  await db.all(`
    SELECT author, text, like_count+comment_count+share_count+save_count AS engagement, ts_iso
    FROM social_posts ORDER BY engagement DESC LIMIT 3
  `); // examples not yet used in stub

  const rising = leaders.slice(0,3).map(l => `• ${l.entity} – ${l.posts} posts, wk ${l.week}, score ${l.score.toFixed(2)}`).join("\n");
  const fading = leaders.slice(-2).map(l => `• ${l.entity} – slower vs wk-1`).join("\n");
  const makeNow = `Make now: trench, loafers, knit in beige, black, red.`;

  const content = `${rising}\n${fading}\n${makeNow}`;
  const now = new Date().toISOString();
  await db.run(`INSERT INTO summaries VALUES (?,?,?,?)`, [region, week || "current", content, now]);
  return { region, week: week || "current", content, created_at: now };
}
