// api/themes/top.js
import prisma from '../../lib/db.js'

export default async function handler(req, res) {
  try {
    const region = (req.query.region || 'All').toString()
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10)))

    const rows = await prisma.theme.findMany({
      where: { region },
      orderBy: [{ week_of: 'desc' }, { heat: 'desc' }],
      take: limit
    })

    const data = rows.map(r => ({
      theme: r.label,
      heat: r.heat,
      momentum: r.momentum,
      forecast_heat: r.payload?.forecast_heat ?? null,
      confidence: r.payload?.confidence ?? 0.5,
      act_watch_avoid: r.payload?.act_watch_avoid ?? 'WATCH',
      links: r.payload?.links ?? []
    }))

    return res.status(200).json({ ok: true, data })
  } catch (e) {
    console.error('themes/top error', e)
    return res.status(500).json({ error: 'Server error' })
  }
}
