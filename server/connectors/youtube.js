// server/connectors/youtube.js
import dotenv from "dotenv";
dotenv.config();

const KEY = process.env.YOUTUBE_API_KEY || "";

export async function fetchYouTube({ keyword, days = 14, regionCode }) {
  if (!KEY) return [];

  const publishedAfter = new Date(
    Date.now() - days * 24 * 3600 * 1000
  ).toISOString();
  const params = new URLSearchParams({
    key: KEY,
    part: "snippet",
    type: "video",
    maxResults: "25",
    q: keyword,
    publishedAfter,
    order: "date",
  });
  if (regionCode && regionCode.length === 2) {
    params.set("regionCode", regionCode);
  }

  try {
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params.toString()}`
    );
    if (!searchRes.ok) return [];
    const searchJson = await searchRes.json();
    const items = searchJson?.items || [];
    const ids = items.map((it) => it?.id?.videoId).filter(Boolean);

    if (!ids.length) return [];

    const statsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids.join(
        ","
      )}&key=${KEY}`
    );
    if (!statsRes.ok) return [];

    const statsJson = await statsRes.json();
    const byId = new Map((statsJson?.items || []).map((v) => [v?.id, v]));

    const hits = items
      .map((it) => {
        const id = it?.id?.videoId;
        const vid = byId.get(id);
        const s = vid?.statistics || {};
        const sn = vid?.snippet || it?.snippet || {};

        const viewCount = Number(s.viewCount || 0);
        if (viewCount < 50000) return null; // skip small creators

        return {
          source: "creator",
          entity_raw: keyword,
          ts_iso:
            sn.publishedAt ||
            it?.snippet?.publishTime ||
            new Date().toISOString(),
          volume: viewCount,
          trend: 0.3,
          fresh: 1,
          url: `https://www.youtube.com/watch?v=${id}`,
          meta: {
            title: sn.title,
            channel: sn.channelTitle,
            viewCount,
            likeCount: Number(s.likeCount || 0),
            commentCount: Number(s.commentCount || 0),
          },
        };
      })
      .filter(Boolean);

    return hits;
  } catch (e) {
    console.warn("[youtube fetch error]", e?.message || e);
    return [];
  }
}
