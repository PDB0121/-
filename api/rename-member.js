import { getRedis } from "./_lib/redis.js";
import { verifyAdminToken } from "./_lib/auth.js";

// 管理員修改成員姓名。姓名在三個地方各存了一份（成員名單、交易紀錄的 userName、各表單訂單的 userName），
// 這裡一次全部更新，歷史明細與統計才不會出現新舊兩種名字。以成員 id 為準，所以餘額與紀錄都不受影響。
// 重複呼叫是安全的（沒改到的才會補改），中途失敗可以直接再按一次。
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const redis = getRedis();
  if (!redis) { res.status(500).json({ error: "找不到 Redis 連線資訊" }); return; }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await verifyAdminToken(redis, token))) { res.status(401).json({ error: "需要管理員登入" }); return; }

  const { userId, name } = req.body || {};
  const newName = typeof name === "string" ? name.trim() : "";
  if (typeof userId !== "string" || !userId) { res.status(400).json({ error: "缺少成員" }); return; }
  if (!newName) { res.status(400).json({ error: "姓名不能空白。" }); return; }
  if (newName.length > 30) { res.status(400).json({ error: "姓名最多 30 個字。" }); return; }

  try {
    const [users, tx] = await redis.mget("users", "tx");
    const userList = Array.isArray(users) ? users : [];
    const target = userList.find((u) => u && u.id === userId);
    if (!target) { res.status(404).json({ error: "找不到這位成員，可能已經被刪除，請重新整理。" }); return; }
    if (userList.some((u) => u && u.id !== userId && u.name === newName)) {
      res.status(409).json({ error: `已經有另一位成員叫「${newName}」，請加上區分，例如「${newName} B」。` });
      return;
    }

    // 交易紀錄
    let txChanged = 0;
    const txList = Array.isArray(tx) ? tx : [];
    const newTx = txList.map((t) => (t && t.userId === userId && t.userName !== newName ? (txChanged++, { ...t, userName: newName }) : t));
    if (txChanged) await redis.set("tx", newTx);

    // 表單訂單：寫入前才讀，縮短跟別人同時送單的空窗
    let ordersChanged = 0;
    const forms = await redis.get("forms");
    if (Array.isArray(forms)) {
      const newForms = forms.map((f) => {
        if (!f || !Array.isArray(f.orders)) return f;
        let hit = false;
        const orders = f.orders.map((o) => (o && o.userId === userId && o.userName !== newName ? (hit = true, ordersChanged++, { ...o, userName: newName }) : o));
        return hit ? { ...f, orders } : f;
      });
      if (ordersChanged) await redis.set("forms", newForms);
    }

    // 成員名單放最後：前面任何一步失敗，成員名單還是舊名字，再按一次就會補完
    await redis.set("users", userList.map((u) => (u && u.id === userId ? { ...u, name: newName } : u)));

    res.status(200).json({ ok: true, oldName: target.name, newName, txChanged, ordersChanged });
  } catch (e) {
    console.error("rename-member error", e);
    res.status(500).json({ error: e.message || "伺服器錯誤" });
  }
}
