import { getRedis } from "./_lib/redis.js";
import { verifyAdminToken } from "./_lib/auth.js";

// 管理員手動更正「扣款明細」。每次更正都會在「更正紀錄」留下更正前後的內容（最近 500 筆），
// 被更正過的明細會帶 correctedAt，畫面上標示「已更正」，成員自己也看得到。
//   GET  ?audit=1                       讀取更正紀錄
//   POST {action:"edit", txId, patch}   修改金額 / 日期 / 原因 / 補充說明
//   POST {action:"delete", txId}        刪除這筆明細
// 明細的類型（訂餐扣款 / 儲值與調整）不能改，不然「累計收款、退款、訂餐扣款」的分類會亂掉。
const AUDIT_KEY = "ledger-audit";
const AUDIT_MAX = 500;
const MAX_AMOUNT = 10_000_000;
const FIELDS = ["amount", "date", "reason", "note"];

const pick = (t) => ({ amount: t.amount, date: t.date, reason: t.reason || "", note: t.note || "" });

function validate(patch, old) {
  if (!patch || typeof patch !== "object") return { error: "沒有要更正的內容。" };
  const out = {};
  if ("amount" in patch) {
    const n = patch.amount;
    if (typeof n !== "number" || !Number.isFinite(n) || n === 0) return { error: "金額要是一個不是 0 的數字。" };
    if (Math.abs(n) > MAX_AMOUNT) return { error: "金額太大了，請確認有沒有多打幾個 0。" };
    const v = Math.round(n * 100) / 100;
    if (old.type === "order" && v > 0) return { error: "訂餐扣款的金額要是負數（扣款）。要增加餘額請用「調整儲值金」。" };
    out.amount = v;
  }
  if ("date" in patch) {
    const d = patch.date;
    // Date.parse 會把不存在的日期（例如 2026-02-31）自動進位成下個月，所以要轉回字串確認跟原本一樣
    const ok = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
      && !Number.isNaN(Date.parse(d)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
    if (!ok) return { error: "日期格式不對，或這一天不存在。" };
    out.date = d;
  }
  if ("reason" in patch) {
    const r = typeof patch.reason === "string" ? patch.reason.trim() : "";
    if (!r) return { error: "原因不能空白。" };
    if (r.length > 100) return { error: "原因最多 100 個字。" };
    out.reason = r;
  }
  if ("note" in patch) {
    const n = typeof patch.note === "string" ? patch.note.trim() : "";
    if (n.length > 100) return { error: "補充說明最多 100 個字。" };
    out.note = n;
  }
  return { patch: out };
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) { res.status(500).json({ error: "找不到 Redis 連線資訊" }); return; }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!(await verifyAdminToken(redis, token))) { res.status(401).json({ error: "需要管理員登入" }); return; }

  try {
    if (req.method === "GET") {
      if (!(req.query && req.query.audit)) { res.status(400).json({ error: "缺少參數" }); return; }
      const a = await redis.get(AUDIT_KEY);
      res.status(200).json({ items: Array.isArray(a) ? a : [] });
      return;
    }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { action, txId, patch } = req.body || {};
    if (typeof txId !== "string" || !txId) { res.status(400).json({ error: "缺少明細" }); return; }

    const tx = await redis.get("tx");
    const list = Array.isArray(tx) ? tx : [];
    const idx = list.findIndex((t) => t && t.id === txId);
    if (idx < 0) { res.status(404).json({ error: "找不到這筆明細，可能已經被更正或刪除，請重新整理。" }); return; }
    const old = list[idx];
    const now = new Date().toISOString();
    const base = { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, at: now, txId, userId: old.userId, userName: old.userName, type: old.type };

    if (action === "edit") {
      const v = validate(patch, old);
      if (v.error) { res.status(400).json({ error: v.error }); return; }
      const before = pick(old);
      const next = { ...old, ...v.patch };
      const after = pick(next);
      const changed = FIELDS.filter((f) => before[f] !== after[f]);
      if (changed.length === 0) { res.status(400).json({ error: "沒有任何變更。" }); return; }
      next.correctedAt = now;

      const audit = await redis.get(AUDIT_KEY);
      await redis.set(AUDIT_KEY, [{ ...base, action: "edit", changed, before, after }, ...(Array.isArray(audit) ? audit : [])].slice(0, AUDIT_MAX));
      await redis.set("tx", list.map((t, i) => (i === idx ? next : t)));
      res.status(200).json({ ok: true, tx: next });
      return;
    }

    if (action === "delete") {
      const audit = await redis.get(AUDIT_KEY);
      await redis.set(AUDIT_KEY, [{ ...base, action: "delete", before: pick(old), removed: old },...(Array.isArray(audit) ? audit : [])].slice(0, AUDIT_MAX));
      await redis.set("tx", list.filter((_, i) => i !== idx));
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "不認得的動作" });
  } catch (e) {
    console.error("ledger-correct error", e);
    res.status(500).json({ error: e.message || "伺服器錯誤" });
  }
}
