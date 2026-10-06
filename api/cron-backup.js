import { getRedis } from "./_lib/redis.js";
import { readIndex, saveSnapshot } from "./_lib/backup.js";

// 由 Vercel 排程每天呼叫一次（vercel.json 的 crons）。
// 如果在 Vercel 專案設定了 CRON_SECRET 環境變數，Vercel 會自動帶上對應的 Authorization，沒帶就拒絕；沒設定就不檢查。
// 就算被別人亂呼叫也只會「沒變動就不存」，而且 10 分鐘內重複呼叫會直接略過，不會灌爆資料庫。
export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const redis = getRedis();
  if (!redis) { res.status(500).json({ error: "找不到 Redis 連線資訊" }); return; }

  try {
    const idx = await readIndex(redis);
    if (idx.lastRun && Date.now() - Date.parse(idx.lastRun.at) < 10 * 60 * 1000) {
      res.status(200).json({ ok: true, skipped: "recent" });
      return;
    }
    const [users, tx] = await redis.mget("users", "tx");
    const result = await saveSnapshot(redis, { users: users || [], tx: tx || [] }, "auto", { dedupe: true });
    res.status(200).json({ ok: true, saved: result.saved, reason: result.reason || null });
  } catch (e) {
    console.error("cron-backup error", e);
    res.status(500).json({ error: e.message || "伺服器錯誤" });
  }
}
