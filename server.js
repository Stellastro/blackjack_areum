import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- DB ---
let pool = null;
let dbReady = false;

if (!DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL env var is not set. Leaderboard API will be unavailable.");
} else {
  pool = new Pool({
    connectionString: DATABASE_URL,
    // Koyeb managed Postgres requires SSL
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });
}

async function ensureTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id SERIAL PRIMARY KEY,
      player TEXT NOT NULL,
      score BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS leaderboard_score_idx
    ON leaderboard (score DESC, created_at ASC);
  `);
}

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.get("/api/leaderboard", async (_req, res) => {
  if (!pool || !dbReady) return res.status(503).json({ error: "db_unavailable" });

  try {
    const { rows } = await pool.query(
      `SELECT player, score FROM leaderboard ORDER BY score DESC, created_at ASC LIMIT 5;`
    );
    res.json({ items: rows });
  } catch (_e) {
    res.status(500).json({ error: "failed_to_load" });
  }
});

app.post("/api/submit", async (req, res) => {
  if (!pool || !dbReady) return res.status(503).json({ error: "db_unavailable" });

  try {
    const player = String(req.body?.player ?? "").trim().slice(0, 40);
    const score = Number(req.body?.score ?? NaN);

    if (!player) return res.status(400).json({ error: "bad_player" });
    if (!Number.isFinite(score)) return res.status(400).json({ error: "bad_score" });

    await pool.query(
      `INSERT INTO leaderboard (player, score) VALUES ($1, $2);`,
      [player, Math.floor(score)]
    );

    // keep only top 5
    await pool.query(`
      DELETE FROM leaderboard
      WHERE id NOT IN (
        SELECT id FROM leaderboard
        ORDER BY score DESC, created_at ASC
        LIMIT 5
      );
    `);

    const { rows } = await pool.query(
      `SELECT player, score FROM leaderboard ORDER BY score DESC, created_at ASC LIMIT 5;`
    );
    const idx = rows.findIndex(r => r.player === player && Number(r.score) === Math.floor(score));

    res.json({
      entered: idx >= 0,
      ...(idx >= 0 ? { rank: idx + 1 } : {}),
      leaderboard: rows
    });
  } catch (_e) {
    res.status(500).json({ error: "failed_to_submit" });
  }
});

// --- static ---
app.use(express.static(path.join(__dirname, "public")));

(async () => {
  try {
    await ensureTable();
    dbReady = !!pool;
    if (dbReady) console.log("DB ready.");
  } catch (e) {
    dbReady = false;
    console.error("DB init failed (service will still run, API returns 503):", e?.message ?? e);
  }

  app.listen(PORT, () => console.log(`Listening on ${PORT}`));
})();
