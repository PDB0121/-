import { getRedis } from "./_lib/redis.js";
import { verifyAdminToken } from "./_lib/auth.js";

// 管理員刪除成員（連同他的儲值與扣款紀錄一起刪）。
// 只要他在任何一張「還沒結算」的表單裡還有訂單就擋下來：那張表單之後結算時還是會替他扣一筆款，
// 但他已經不在名單上，那筆錢不會算進總儲值金餘額，現金就對不上了。
//   POST {userId, dryRun:true}  只檢查：回傳能不能刪、目前餘額、擋住的表單
//   POST {userId}               真的刪除（伺服器端會再檢查一次）
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const redis = getRedis();
  if (!redis) { res.status(500).json({ error: "找不到 Redis 連線資訊" }); return; }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await verifyAdminToken(redis, token))) { res.status(401).json({ error: "需要管理員登入" }); return; }

  const { userId, dryRun } = req.body || {};
  if (typeof userId !== "string" || !userId) { res.status(400).json({ error: "缺少成員" }); return; }

  try {
    const [users, tx, forms] = await redis.mget("users", "tx", "forms");
    const userList = Array.isArray(users) ? users : [];
    const target = userList.find((u) => u && u.id === userId);
    if (!target) { res.status(404).json({ error: "找不到這位成員，可能已經被刪除，請重新整理。" }); return; }

    const txList = Array.isArray(tx) ? tx : [];
    const mine = txList.filter((t) => t && t.userId === userId);
    const balance = mine.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    const blockers = (Array.isArray(forms) ? forms : [])
      .filter((f) => f && !f.settled && Array.isArray(f.orders) && f.orders.some((o) => o && o.userId === userId))
      .map((f) => ({ id: f.id, title: f.title, date: f.date }));

    if (dryRun) {
      res.status(200).json({ ok: true, canDelete: blockers.length === 0, name: target.name, balance, txCount: mine.length, forms: blockers });
      return;
    }
    if (blockers.length > 0) {
      res.status(409).json({ error: "這位成員在還沒結算的表單裡還有訂單，不能刪除。", forms: blockers });
      return;
    }

    // 先刪交易紀錄、最後才刪成員：中途失敗時他還在名單上，再按一次就會完成，不會留下沒有主人的交易紀錄
    if (mine.length > 0) await redis.set("tx", txList.filter((t) => !(t && t.userId === userId)));
    await redis.set("users", userList.filter((u) => !(u && u.id === userId)));

    res.status(200).json({ ok: true, name: target.name, balance, removedTx: mine.length });
  } catch (e) {
    console.error("remove-member error", e);
    res.status(500).json({ error: e.message || "伺服器錯誤" });
  }
}
