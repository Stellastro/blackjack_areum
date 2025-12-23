export function createLeaderboardClient() {
  async function getTop5() {
    const r = await fetch("/api/leaderboard", { cache: "no-store" });
    if (!r.ok) throw new Error("leaderboard_load_failed");
    return await r.json();
  }

  async function submit(player, score) {
    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player, score })
    });
    if (!r.ok) throw new Error("leaderboard_submit_failed");
    return await r.json();
  }

  return { getTop5, submit };
}
