// server/sqlite.js
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export class Database {
  static instance;
  static async get() {
    if (!Database.instance) {
      Database.instance = await open({
        filename: "trends.sqlite",
        driver: sqlite3.Database
      });

      // Base (Data mode)
      await Database.instance.exec(`
        CREATE TABLE IF NOT EXISTS social_posts (
          platform TEXT, post_id TEXT, post_url TEXT, author TEXT, author_followers INT,
          ts_iso TEXT, language TEXT, text TEXT, hashtags TEXT,
          like_count INT, comment_count INT, share_count INT, save_count INT,
          video_views INT, geo_country TEXT
        );

        CREATE TABLE IF NOT EXISTS entities (
          entity TEXT, type TEXT, week TEXT, region TEXT,
          posts INT, eng_sum INT, eng_rate_median REAL,
          score REAL, growth REAL,
          UNIQUE(entity, type, week, region) ON CONFLICT REPLACE
        );
        CREATE INDEX IF NOT EXISTS idx_entities_lookup ON entities(type, region, week);
        CREATE INDEX IF NOT EXISTS idx_entities_score ON entities(score DESC);

        CREATE TABLE IF NOT EXISTS summaries (
          region TEXT, week TEXT, content TEXT, created_at TEXT
        );

        /* Research mode (raw runs + evidence) */
        CREATE TABLE IF NOT EXISTS research_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          region TEXT,
          created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS research_hits (
          run_id INT,
          source TEXT,
          entity_raw TEXT,
          entity_mapped TEXT,
          type TEXT,
          ts_iso TEXT,
          volume REAL,
          trend REAL,
          fresh REAL,
          weight REAL,
          score REAL,
          url TEXT,
          meta_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_research_hits ON research_hits(run_id, score DESC);
      `);

      // ---- Migrations (idempotent) ----
      const addColIfMissing = async (table, col, type) => {
        const cols = await Database.instance.all(`PRAGMA table_info(${table})`);
        const names = new Set(cols.map(c => c.name));
        if (!names.has(col)) {
          await Database.instance.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
        }
      };

      await addColIfMissing("research_runs", "keywords_json", "TEXT");
      await addColIfMissing("research_runs", "content_json", "TEXT");
      await addColIfMissing("research_runs", "status", "TEXT");

      // Signals (normalized from connectors)
      await Database.instance.exec(`
        CREATE TABLE IF NOT EXISTS signals (
          date TEXT,            -- YYYY-MM-DD
          keyword TEXT,         -- normalized lowercase
          source TEXT,          -- youtube | trends | news | reddit (alias)
          value REAL,
          meta_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_signals_k ON signals(keyword);
        CREATE INDEX IF NOT EXISTS idx_signals_d ON signals(date);
      `);

      // Weekly themes snapshot
      await Database.instance.exec(`
        CREATE TABLE IF NOT EXISTS themes (
          week TEXT,            -- YYYY-Www
          theme TEXT,
          heat REAL,
          momentum REAL,
          sources_json TEXT,    -- [{source,z,weight}]
          top_links_json TEXT,  -- [url,...]
          act_watch_avoid TEXT, -- ACT | WATCH | AVOID
          created_at TEXT,
          UNIQUE(week, theme) ON CONFLICT REPLACE
        );
        CREATE INDEX IF NOT EXISTS idx_themes_week ON themes(week);
      `);

      // Briefs
      await Database.instance.exec(`
        CREATE TABLE IF NOT EXISTS briefs (
          week TEXT,
          region TEXT,
          content TEXT,
          created_at TEXT
        );
      `);

      // Watchlist per region
      await Database.instance.exec(`
        CREATE TABLE IF NOT EXISTS watchlist (
          region TEXT PRIMARY KEY,
          keywords_json TEXT,
          updated_at TEXT
        );
      `);
    }
    return Database.instance;
  }
}
