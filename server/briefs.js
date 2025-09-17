// server/briefs.js
import fs from "fs";
import PDFDocument from "pdfkit";
import { getTopThemes } from "./themes.js";

/* ---------- Source filtering & tagging ---------- */
const FASHION_SOURCES = JSON.parse(
  fs.readFileSync(new URL("./fashion_sources.json", import.meta.url))
);

function domainOf(url = "") {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname; // allows matching path segments like /fashion
  } catch {
    return "";
  }
}

function isEditorial(url = "") {
  const d = domainOf(url);
  return FASHION_SOURCES.some((allow) => d.includes(allow));
}

function isCreator(url = "") {
  // Right now: YouTube only. (TikTok can be added when available)
  return /youtube\.com\/watch/.test(url);
}

function tagFor(url = "") {
  if (isEditorial(url)) return "[Editorial]";
  if (isCreator(url)) return "[Creator]";
  return "[Other]";
}

/* ---------- PDF helpers ---------- */
function title(doc, txt) {
  doc.rect(0, 0, doc.page.width, 120).fill("#0b1218");
  doc.fillColor("#ffffff").fontSize(22).text(txt, 48, 48);
}

function subtitle(doc, txt) {
  doc.fillColor("#bfe1ff").fontSize(12).text(txt, 48, 80);
  doc.fillColor("#000000");
}

function h2(doc, text) {
  doc.moveDown(0.6).fontSize(16).fillColor("#0b1218").text(text);
  doc.moveDown(0.2);
}

function p(doc, text) {
  doc.fontSize(11).fillColor("#0b1218").text(text);
}

function metricCell(doc, label, value) {
  doc.fontSize(10).fillColor("#4a4a4a").text(label);
  doc.fontSize(14).fillColor("#0b1218").text(value);
}

function momentumArrow(m) {
  return m > 0 ? "↑" : "↓";
}

function confPct(c) {
  return typeof c === "number" ? `${Math.round(c * 100)}%` : "—";
}

/* ---------- Main generator ---------- */
export async function generateBriefPDF({ region = "Nordics", week = null } = {}) {
  // Pull latest top themes snapshot (will contain heat/momentum; forecast/confidence may be undefined for older rows)
  const top = await getTopThemes({ region, week, limit: 6 });

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  /* Cover */
  title(doc, "Trend Radar — Weekly Brief");
  subtitle(doc, `${region} • ${top[0]?.week || "This Week"}`);

  /* What’s rising */
  h2(doc, "What’s rising");
  if (top.length) {
    top.slice(0, 3).forEach((t) => {
      const heat = Math.round(t.heat);
      const mom = momentumArrow(t.momentum);
      const forecast = typeof t.forecast_heat === "number" ? ` → ${Math.round(t.forecast_heat)}` : "";
      const conf = t.confidence != null ? ` (conf ${confPct(t.confidence)})` : "";
      p(doc, `• ${t.theme} — heat ${heat} ${mom}${forecast}${conf}`);
    });
  } else {
    p(doc, "—");
  }

  /* Why this matters */
  h2(doc, "Why this matters");
  p(
    doc,
    "Signals from editorial, search, and high-reach creators indicate where demand is heating up. We rank credible fashion media (Vogue, BoF, WWD, etc.) highest, then confirm with search interest and creator velocity. Forecast is a short-term projection (2 weeks) with confidence based on history and volatility."
  );

  /* Top movers table (compact) */
  h2(doc, "Top movers");
  const startX = 48;
  const colW = [210, 70, 80, 80, 80]; // Theme, Heat, Momentum, Forecast, Confidence
  const headers = ["Theme", "Heat", "Momentum", "Forecast (2w)", "Confidence"];
  doc.fontSize(11).fillColor("#0b1218");
  headers.forEach((h, i) =>
    doc.text(h, startX + colW.slice(0, i).reduce((a, b) => a + b, 0), doc.y, {
      continued: i !== headers.length - 1,
      width: colW[i],
    })
  );
  doc.moveDown(0.2);
  top.slice(0, 6).forEach((t) => {
    const heat = String(Math.round(t.heat));
    const mom = momentumArrow(t.momentum);
    const forecast = typeof t.forecast_heat === "number" ? String(Math.round(t.forecast_heat)) : "—";
    const conf = confPct(t.confidence);
    const values = [t.theme, heat, mom, forecast, conf];
    values.forEach((v, i) =>
      doc.text(v, startX + colW.slice(0, i).reduce((a, b) => a + b, 0), doc.y, {
        continued: i !== values.length - 1,
        width: colW[i],
      })
    );
    doc.moveDown(0.2);
  });

  /* What to do now (actionable) */
  h2(doc, "What to do now");
  p(doc, "• Prototype 2–3 looks that reflect top themes; brief creators this week and track save/comment lift vs baseline.");
  p(doc, "• Buy planning: bias toward high-heat themes with positive momentum; test a small accent pack before scaling.");
  p(doc, "• Set a watchlist alert when 7-day search + editorial both rise >1.3× week-over-week.");

  /* Evidence */
  h2(doc, "Evidence (top sources)");
  // Only show Editorial + high-reach Creator links; 2 per theme
  top.slice(0, 3).forEach((t) => {
    // Prefer editorial links; if not enough, add creator
    const editorial = (t.links || []).filter((u) => isEditorial(u));
    const creators = (t.links || []).filter((u) => !isEditorial(u) && isCreator(u));
    const show = [...editorial.slice(0, 2), ...creators.slice(0, Math.max(0, 2 - editorial.length))];

    if (show.length) {
      doc.fontSize(11).fillColor("#0b1218").text(`${t.theme}:`);
      show.forEach((u) => {
        const tag = tagFor(u);
        // Render as clickable link
        doc
          .fontSize(10)
          .fillColor("#0b1218")
          .text(`- ${tag} ${u}`, { link: u, underline: true });
      });
      doc.moveDown(0.2);
    }
  });

  /* Footer mini-legend */
  doc.moveDown(0.8);
  doc.fontSize(9).fillColor("#666666").text(
    "Notes: Heat is a 0–100 scale from source-weighted z-scores vs the last 8 weeks. Momentum compares the last 2 weeks. Forecast is a 2-week projection of weighted z. Confidence reflects history length and volatility. Editorial sources are whitelisted (Vogue, BoF, WWD, etc.); creator evidence requires high reach."
  );

  doc.end();
  return done;
}
