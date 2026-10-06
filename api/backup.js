import { getRedis } from "./_lib/redis.js";
import { verifyAdminToken } from "./_lib/auth.js";
import { readIndex, readSnapshot, saveSnapshot, buildSnapshot, restoreSnapshot } from "./_lib/backup.js";

// 管理員專用的備份 API（全部都要帶登入憑證）
//   GET  ?list=1       備份清單與自動備份狀態
//   GET  ?id=<備份 id>  讀取某一份備份的完整內容（下載用）
//   GET  ?current=1    把「現在」的資料即時組成一份備份內容（下載用，不會存起來）
//   POST {action:"create"}                          立即手動備份一份
//   POST {action:"restore", id | snapshot}          還原（會先自動把現在的資料另存一份）
export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) { res.status(500).json({ error: "找不到 Redis 連線資訊" }); return; }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await verifyAdminToken(redis, token))) { res.status(401).json({ error: "需要管理員登入" }); return; }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (q.list) { res.status(200).json(await readIndex(redis)); return; }
      if (q.current) {
        const [users, tx] = await redis.mget("users", "tx");
        res.status(200).json(buildSnapshot({ users: users || [], tx: tx || [] }, "manual"));
        return;
      }
      if (q.id) {
        const snap = await readSnapshot(redis, String(q.id));
        if (!snap) { res.status(404).json({ error: "找不到這份備份" }); return; }
        res.status(200).json(snap);
        return;
      }
      res.status(400).json({ error: "缺少參數" });
      return;
    }

    if (req.method === "POST") {
      const { action, id, snapshot } = req.body || {};

      if (action === "create") {
        const [users, tx] = await redis.mget("users", "tx");
        const r = await saveSnapshot(redis, { users: users || [], tx: tx || [] }, "manual");
        res.status(200).json({ ok: true, entry: r.entry });
        return;
      }

      if (action === "restore") {
        const snap = snapshot || (await readSnapshot(redis, String(id || "")));
        if (!snap) { res.status(404).json({ error: "找不到這份備份" }); return; }
        const r = await restoreSnapshot(redis, snap);
        if (!r.ok) { res.status(400).json({ error: r.error }); return; }
        res.status(200).json(r);
        return;
      }

      res.status(400).json({ error: "不認得的動作" });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("backup api error", e);
    res.status(500).json({ error: e.message || "伺服器錯誤" });
  }
}
