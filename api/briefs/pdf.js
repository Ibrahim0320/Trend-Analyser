// api/briefs/pdf.js
// ✅ Run as a Node Function (serverless on Vercel), not Edge.
export const config = { runtime: 'nodejs' }

import prisma from '../../lib/db.js'

export default async function handler(req, res) {
  try {
    // Lazy-load pdfkit to keep cold start small
    const { default: PDFDocument } = await import('pdfkit')

    // region from query (?region=Nordics) — works with Vercel Node runtime
    const region =
      (req.query?.region ||
        new URL(req.url, 'http://x').searchParams.get('region') ||
        'All').toString()

    // Latest run & top themes
    const latestRun = await prisma.researchRun.findFirst({
      where: { region },
      orderBy: { created_at: 'desc' }
    })

    const themes = await prisma.theme.findMany({
      where: { region },
      orderBy: [{ week_of: 'desc' }, { heat: 'desc' }],
      take: 10
    })

    // Build PDF in memory
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks = []
    doc.on('data', d => chunks.push(d))
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="trend-brief-${region}.pdf"`
      )
      res.status(200).send(pdf)
    })

    doc.fontSize(18).text(`Trend Brief — ${region}`, { align: 'left' })
    doc.moveDown(0.5)
    doc.fontSize(10).fillColor('#666').text(`Generated: ${new Date().toISOString()}`)
    doc.moveDown(1)

    doc.fillColor('#000').fontSize(14).text('Top Movers (themes)')
    doc.moveDown(0.5)
    themes.forEach((t, i) => {
      const arrow = t.momentum > 0 ? '↑' : '↓'
      doc.fontSize(11).text(`${i + 1}. ${t.label} — heat ${Math.round(t.heat)} ${arrow}`)
    })
    doc.moveDown(1)

    doc.fontSize(14).text('Keywords used (latest run)')
    doc.moveDown(0.5)
    doc.fontSize(11).text(latestRun?.keywords_json?.join(', ') || '—')

    doc.end()
  } catch (err) {
    console.error('briefs/pdf error', err)
    res.status(500).json({ error: 'Server error' })
  }
}

