// server/index.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import { parse } from "csv-parse";
import dotenv from "dotenv";
dotenv.config();

import { Database } from "./sqlite.js";
import {
  computeTrendsForUpload,
  getTopEntities,
  getTimeSeries,
  getCooccur,
  getTopCreators,
  generateSummary,
} from "./trends.js";
import { runResearch, latestResearch } from "./research.js";
import { computeThemes, getTopThemes, getThemeOne } from "./themes.js";
import { generateBriefPDF } from "./briefs.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
const upload = multer({ dest: "uploads/" });

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));

app.get("/api/health", (req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);
app.get("/", (req, res) =>
  res.send("AI Trend Dashboard API is running. Try GET /api/health")
);

/* ---------- Data mode ---------- */
app.post("/api/trends/upload", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true }))
      .on("data", (row) => rows.push(row))
      .on("end", async () => {
        await computeTrendsForUpload(rows);
        fs.unlinkSync(filePath);
        res.json({ ok: true, imported: rows.length });
      });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});
app.get("/api/trends/top", async (req, res) => {
  const { type = "hashtag", region = "Nordics", week, limit = 20 } = req.query;
  const data = await getTopEntities(type, region, week, Number(limit));
  res.json({ ok: true, data });
});
app.get("/api/trends/timeseries", async (req, res) => {
  const { entity, type = "hashtag", region = "Nordics", weeks = 8 } = req.query;
  const data = await getTimeSeries(entity, type, region, Number(weeks));
  res.json({ ok: true, data });
});
app.get("/api/trends/cooccur", async (req, res) => {
  const { left = "items", right = "colors", region = "Nordics", week } = req.query;
  const data = await getCooccur(left, right, region, week);
  res.json({ ok: true, data });
});
app.get("/api/creators/top", async (req, res) => {
  const { entity, region = "Nordics", week } = req.query;
  const data = await getTopCreators(entity, region, week);
  res.json({ ok: true, data });
});
app.post("/api/trends/summary/generate", async (req, res) => {
  const { region = "Nordics", week } = req.body ?? {};
  const summary = await generateSummary(region, week);
  res.json({ ok: true, summary });
});
app.get("/api/trends/summary/latest", async (req, res) => {
  const { region = "Nordics" } = req.query;
  const db = await Database.get();
  const row = await db.get(
    `SELECT * FROM summaries WHERE region = ? ORDER BY created_at DESC LIMIT 1`,
    [region]
  );
  res.json({ ok: true, summary: row });
});

/* ---------- Research mode ---------- */
app.post("/api/research/run", async (req, res) => {
  try {
    const { region = "Nordics", keywords = [], window_days = 28 } = req.body ?? {};
    // Run connectors + persist raw signals/hits
    const data = await runResearch({ region, keywords, window_days });
    // Immediately compute themes so UI + briefs have content without extra click
    const themes = await computeThemes({ region });
    res.json({ ok: true, data, themes: themes.slice(0, 10) });
  } catch (e) {
    console.error("[/api/research/run] error", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});
app.get("/api/research/latest", async (req, res) => {
  try {
    const { region = "Nordics" } = req.query;
    const data = await latestResearch(region);
    if (!data) return res.status(404).json({ ok: false, error: "No research runs yet" });
    res.json({ ok: true, data });
  } catch (e) {
    console.error("[/api/research/latest] error", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ---------- Watchlist: GET/POST (replace) ---------- */
app.get("/api/research/watchlist", async (req, res) => {
  const { region = "Nordics" } = req.query;
  const db = await Database.get();
  const row = await db.get(`SELECT * FROM watchlist WHERE region = ?`, [region]);
  res.json({ ok: true, keywords: row ? JSON.parse(row.keywords_json || "[]") : [] });
});

app.post("/api/research/watchlist", async (req, res) => {
  const { region = "Nordics", keywords = [] } = req.body ?? {};
  const db = await Database.get();
  await db.run(
    `INSERT INTO watchlist(region, keywords_json, updated_at) VALUES(?,?,?)
     ON CONFLICT(region) DO UPDATE SET keywords_json=excluded.keywords_json, updated_at=excluded.updated_at`,
    [region, JSON.stringify(keywords || []), new Date().toISOString()]
  );
  res.json({ ok: true });
});

/* ---------- Watchlist: PATCH (add/remove), DELETE (clear) ---------- */
app.patch("/api/research/watchlist", async (req, res) => {
  const { region = "Nordics", add = [], remove = [] } = req.body ?? {};
  const db = await Database.get();
  const row = await db.get(`SELECT * FROM watchlist WHERE region = ?`, [region]);
  let current = row ? JSON.parse(row.keywords_json || "[]") : [];

  const set = new Set(current.map((k) => String(k).trim().toLowerCase()).filter(Boolean));
  (add || []).forEach((k) => set.add(String(k).trim().toLowerCase()));
  (remove || []).forEach((k) => set.delete(String(k).trim().toLowerCase()));

  const updated = Array.from(set);
  await db.run(
    `INSERT INTO watchlist(region, keywords_json, updated_at) VALUES(?,?,?)
     ON CONFLICT(region) DO UPDATE SET keywords_json=excluded.keywords_json, updated_at=excluded.updated_at`,
    [region, JSON.stringify(updated), new Date().toISOString()]
  );
  res.json({ ok: true, keywords: updated });
});

app.delete("/api/research/watchlist", async (req, res) => {
  const { region = "Nordics" } = req.query;
  const db = await Database.get();
  await db.run(
    `INSERT INTO watchlist(region, keywords_json, updated_at) VALUES(?,?,?)
     ON CONFLICT(region) DO UPDATE SET keywords_json='[]', updated_at=excluded.updated_at`,
    [region, "[]", new Date().toISOString()]
  );
  res.json({ ok: true, keywords: [] });
});

/* ---------- Refresh using watchlist ---------- */
app.post("/api/research/refresh", async (req, res) => {
  const { region = "Nordics", window_days = 28 } = req.body ?? {};
  const db = await Database.get();
  const row = await db.get(`SELECT * FROM watchlist WHERE region = ?`, [region]);
  const keywords = row ? JSON.parse(row.keywords_json || "[]") : [];
  if (keywords.length) {
    await runResearch({ region, keywords, window_days });
  }
  const themes = await computeThemes({ region });
  res.json({ ok: true, themes: themes.slice(0, 10) });
});

/* ---------- Themes & briefs ---------- */
app.get("/api/themes/top", async (req, res) => {
  const { region = "Nordics", week, limit = 10 } = req.query;
  const data = await getTopThemes({ region, week: week || null, limit: Number(limit) });
  res.json({ ok: true, data });
});
app.get("/api/themes/one", async (req, res) => {
  const { theme, weeks = 8 } = req.query;
  const data = await getThemeOne({ theme, weeks: Number(weeks) });
  res.json({ ok: true, data });
});

// PDF brief
app.get("/api/briefs/pdf", async (req, res) => {
  const { region = "Nordics", week } = req.query;
  try {
    const pdf = await generateBriefPDF({ region, week: week || null });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="trend-brief-${region}-${week || "this-week"}.pdf"`
    );
    res.send(pdf);
  } catch (e) {
    console.error("[/api/briefs/pdf] error", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  await Database.get();
  console.log("Server on http://localhost:" + PORT);
});
