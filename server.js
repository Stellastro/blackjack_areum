import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL env var is not set. Leaderboard API will fail.");
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    })
  : null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

async function ensureTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      player TEXT PRIMARY KEY,
      score INTEGER NOT NULL,
      achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function trimTop5() {
  if (!pool) return;
  await pool.query(`
    DELETE FROM leaderboard
    WHERE player NOT IN (
      SELECT player FROM leaderboard
      ORDER BY score DESC, achieved_at ASC
      LIMIT 5
    );
  `);
}

app.get("/api/leaderboard", async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: "db_not_configured" });

    const { rows } = await pool.query(`
      SELECT player, score
      FROM leaderboard
      ORDER BY score DESC, achieved_at ASC
      LIMIT 5
    `);

    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: "failed_to_load" });
  }
});

app.post("/api/submit", async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: "db_not_configured" });

    let { player, score } = req.body || {};
    if (typeof player !== "string") player = "";
    player = player.trim().slice(0, 30); // 한국어 포함, 길이만 제한

    score = Number(score);
    if (!player) return res.status(400).json({ error: "player_required" });
    if (!Number.isFinite(score) || score < 0) return res.status(400).json({ error: "invalid_score" });

    // 동일 이름: 최고점만 유지(동점/하락은 무시)
    await pool.query(
      `
      INSERT INTO leaderboard (player, score, achieved_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (player) DO UPDATE
        SET score = EXCLUDED.score,
            achieved_at = NOW()
      WHERE EXCLUDED.score > leaderboard.score
      `,
      [player, Math.floor(score)]
    );

    await trimTop5();

    const { rows } = await pool.query(`
      SELECT player, score
      FROM leaderboard
      ORDER BY score DESC, achieved_at ASC
      LIMIT 5
    `);

    const idx = rows.findIndex(r => r.player === player);
    res.json({
      entered: idx >= 0,
      ...(idx >= 0 ? { rank: idx + 1 } : {}),
      leaderboard: rows
    });
  } catch (e) {
    res.status(500).json({ error: "failed_to_submit" });
  }
});

await ensureTable();
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
