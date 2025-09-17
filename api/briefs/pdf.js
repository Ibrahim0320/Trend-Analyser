// api/briefs/pdf.js
import PDFDocument from 'pdfkit'
import prisma from '../../lib/db.js'

export const config = { runtime: 'edge' } // smaller cold start on Vercel Edge

export default async function handler(req, res) {
  try {
    const { searchParams } = new URL(req.url)
    const region = (searchParams.get('region') || 'All').toString()

    // Pull the latest run & themes
    const latestRun = await prisma.researchRun.findFirst({
      where: { region },
      orderBy: { created_at: 'desc' }
    })
    const themes = await prisma.theme.findMany({
      where: { region },
      orderBy: [{ week_of: 'desc' }, { heat: 'desc' }],
      take: 10
    })

    // Build simple PDF
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks = []
    doc.on('data', d => chunks.push(d))
    doc.on('end', () => {
      const pdf = Buffer.concat(chunks)
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="trend-brief-${region}.pdf"`)
      res.status(200).send(pdf)
    })

    doc.fontSize(18).text(`Trend Brief — ${region}`, { align: 'left' })
    doc.moveDown(0.5)
    doc.fontSize(10).fillColor('#666').text(`Generated: ${new Date().toISOString()}`)
    doc.moveDown(1)

    doc.fillColor('#000').fontSize(14).text('Top Movers (themes)')
    doc.moveDown(0.5)
    themes.forEach((t, i) => {
      doc.fontSize(11).text(`${i+1}. ${t.label} — heat ${Math.round(t.heat)}${t.momentum>0?' ↑':' ↓'}`)
    })
    doc.moveDown(1)

    doc.fontSize(14).text('Keywords used (latest run)')
    doc.moveDown(0.5)
    doc.fontSize(11).text(latestRun?.keywords_json?.join(', ') || '—')

    doc.end()
  } catch (e) {
    console.error('briefs/pdf error', e)
    return res.status(500).json({ error: 'Server error' })
  }
}
