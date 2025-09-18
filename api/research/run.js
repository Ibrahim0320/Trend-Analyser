// api/research/run.js
import prisma from '../../lib/db.js'

// This is a minimal “research” implementation so your UI works on Vercel.
// It stores the run and synthesizes simple leaders/themes from the keywords.
// You can later replace the synth logic with your live fetchers.

function synthLeaders(keywords = []) {
  const now = Date.now()
  return keywords.slice(0, 6).map((k, i) => ({
    entity: k,
    type: i % 2 === 0 ? 'item' : 'topic',
    trend: Math.random() * 0.7 + 0.3,        // 30–100%
    volume: Math.floor(Math.random() * 12000),
    score: Math.random() * 60 + 20,
    urls: [],
  }))
}

function leadersToThemes(leaders = []) {
  return leaders.map(l => ({
    theme: l.entity,
    heat: Math.min(100, Math.round(l.score)),
    momentum: Math.random() > 0.5 ? 1 : -1,
    forecast_heat: Math.round(Math.min(100, l.score + Math.random() * 10)),
    confidence: 0.5,
    act_watch_avoid: l.score >= 70 ? 'ACT' : (l.score >= 45 ? 'WATCH' : 'AVOID'),
    links: []
  }))
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const region = (req.body?.region || 'All').toString()
    const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords : []

    // Create a simple run record
    const run = await prisma.researchRun.create({
      data: {
        region,
        keywords_json: keywords,
        created_at: new Date()
      }
    })

    // Synthesize results for now (no external calls in this minimal drop-in)
    const leaders = synthLeaders(keywords)
    const rising = leaders.slice(0, 6).map(l => `• ${l.entity} – ${l.type} (trend ${Math.round(l.trend*100)}%, vol ${l.volume})`)

    // Upsert simple theme snapshot for /api/themes/top
    for (const t of leadersToThemes(leaders)) {
      await prisma.theme.create({
        data: {
          region,
          label: t.theme,
          heat: t.heat,
          momentum: t.momentum,
          payload: {
            forecast_heat: t.forecast_heat,
            confidence: t.confidence,
            act_watch_avoid: t.act_watch_avoid,
            links: t.links
          },
          week_of: new Date(new Date().toISOString().slice(0,10))
        }
      })
    }

    const payload = {
      region,
      rising,
      whyMatters: 'External signals show momentum across search, video, and news. Items/colors reflect transitional styling and neutrals; YouTube velocity suggests near-term creator uptake.',
      aheadOfCurve: [
        'Prototype 3 looks and brief creators this week; measure save/comment lift vs baseline.',
        'Pre-book core neutrals; test small red accents to validate before scaling.',
        'Set a watchlist alert when the 7d trend > 1.3× across two sources.'
      ],
      leaders,
      sourceCounts: { trends: 0, youtube: 0, gdelt: 0, reddit: 0 },
      citations: []
    }

    return res.status(200).json({ ok: true, data: payload })
  } catch (e) {
    console.error('research/run error', e)
    return res.status(500).json({ error: 'Server error' })
  }
}


