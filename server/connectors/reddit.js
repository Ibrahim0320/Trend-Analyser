// server/connectors/reddit.js
// Lightweight, no-auth search via old.reddit JSON endpoints (rate limits apply).
export async function fetchReddit({ keyword, days=14 }) {
  const since = Date.now() - days*24*3600*1000;
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&limit=25&sort=new`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "ai-trend-dashboard/1.0" }});
    if (!r.ok) return [];
    const j = await r.json().catch(()=>null);
    const children = j?.data?.children || [];
    return children
      .map(c => c?.data)
      .filter(d => d && (d.created_utc*1000) >= since)
      .map(d => ({
        source: "reddit",
        entity_raw: keyword,
        ts_iso: new Date(d.created_utc*1000).toISOString(),
        volume: 1 + Number(d.ups||0) + Number(d.num_comments||0),
        trend: 0.2,
        fresh: 0.9,
        url: `https://www.reddit.com${d.permalink}`,
        meta: { title: d.title, ups: d.ups, numComments: d.num_comments, subreddit: d.subreddit }
      }));
  } catch {
    return [];
  }
}
