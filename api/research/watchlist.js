// api/research/watchlist.js
import prisma from '../../lib/db.js'

export default async function handler(req, res) {
  try {
    const { method } = req
    const region = (req.query.region || req.body?.region || 'All').toString()

    if (method === 'GET') {
      const rows = await prisma.watchlist.findMany({ where: { region }, orderBy: { keyword: 'asc' } })
      return res.status(200).json({ region, keywords: rows.map(r => r.keyword) })
    }

    if (method === 'POST') {
      const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords : []
      await prisma.$transaction([
        prisma.watchlist.deleteMany({ where: { region } }),
        prisma.watchlist.createMany({
          data: keywords.map(k => ({ region, keyword: k.toLowerCase() })),
          skipDuplicates: true
        })
      ])
      return res.status(200).json({ region, keywords })
    }

    if (method === 'PATCH') {
      const remove = Array.isArray(req.body?.remove) ? req.body.remove : []
      await prisma.watchlist.deleteMany({ where: { region, keyword: { in: remove.map(s => s.toLowerCase()) } } })
      const rows = await prisma.watchlist.findMany({ where: { region }, orderBy: { keyword: 'asc' } })
      return res.status(200).json({ region, keywords: rows.map(r => r.keyword) })
    }

    if (method === 'DELETE') {
      await prisma.watchlist.deleteMany({ where: { region } })
      return res.status(200).json({ region, keywords: [] })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('watchlist error', e)
    return res.status(500).json({ error: 'Server error' })
  }
}
