import { getRedis } from "./_lib/redis.js";
import { signAdminToken } from "./_lib/auth.js";
import { normalizeStoredForms } from "./_lib/forms.js";

const MAX_FAILS = 10;
const FAIL_WINDOW_SEC = 10 * 60;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const redis = getRedis();
  if (!redis) {
    res.status(500).json({ error: "找不到 Redis 連線資訊" });
    return;
  }

  try {
    // 密碼通常只有幾位數，沒有次數限制的話可以直接寫程式暴力猜，所以同一個來源 IP 連續猜錯太多次就先擋一陣子
    const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
    const failKey = `__login_fail:${ip}`;
    const fails = Number(await redis.get(failKey)) || 0;
    if (fails >= MAX_FAILS) {
      res.status(429).json({ error: "嘗試次數太多，請 10 分鐘後再試" });
      return;
    }

    const { pin } = req.body || {};
    const cfg = (await redis.get("cfg")) || {};
    const realPin = String(cfg.pin || "0000");

    if (typeof pin !== "string" || pin !== realPin) {
      await redis.incr(failKey);
      await redis.expire(failKey, FAIL_WINDOW_SEC);
      res.status(401).json({ error: "密碼不對" });
      return;
    }

    await redis.del(failKey);
    // 趁管理員登入把還內嵌在 forms 裡的舊照片搬到獨立的 key（沒有舊照片時只多一次讀取）。失敗也不影響登入。
    await normalizeStoredForms(redis).catch((e) => console.error("normalizeStoredForms", e));
    const token = await signAdminToken(redis);
    res.status(200).json({ ok: true, token });
  } catch (e) {
    console.error("admin-login error", e);
    res.status(500).json({ error: e.message || "伺服器錯誤" });
  }
}
