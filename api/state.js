import { getRedis } from "./_lib/redis.js";
import { verifyAdminToken, signAdminToken, revokeAllAdminTokens } from "./_lib/auth.js";
import { stripInlineImages, externalizeImages } from "./_lib/forms.js";

const KEYS = ["users", "forms", "tx", "cfg"];
const DEFAULTS = {
  users: [],
  forms: [],
  tx: [],
  cfg: { pin: "0000", title: "今天吃什麼" },
};
// 訂餐者填單只會動到 forms；成員、儲值、交易、設定都是管理員專屬操作
const ADMIN_ONLY_KEYS = new Set(["users", "tx", "cfg"]);

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) {
    res.status(500).json({
      error:
        "找不到 Redis 連線資訊。請到 Vercel 專案的 Storage 分頁建立 Redis 資料庫並 Connect 到這個專案，" +
        "然後在 Settings → Environment Variables 確認有 *_REST_URL / *_REST_TOKEN 這組變數，接著 Redeploy。",
    });
    return;
  }

  try {
    if (req.method === "GET") {
      // 一個指令讀完四個 key（原本是四個指令），免費方案的指令數是每月 50 萬次
      const values = await redis.mget(...KEYS);
      const state = {};
      KEYS.forEach((k, i) => { state[k] = values[i] ?? DEFAULTS[k]; });
      state.forms = stripInlineImages(state.forms);
      // 管理員密碼只存在伺服器端，絕對不回傳給瀏覽器
      const { pin, ...publicCfg } = state.cfg || {};
      state.cfg = publicCfg;
      res.status(200).json(state);
      return;
    }

    if (req.method === "POST") {
      const { key, value, token } = req.body || {};
      if (!KEYS.includes(key)) {
        res.status(400).json({ error: "無效的 key" });
        return;
      }

      if (ADMIN_ONLY_KEYS.has(key) && !(await verifyAdminToken(redis, token))) {
        res.status(401).json({ error: "需要管理員登入" });
        return;
      }

      if (key === "cfg") {
        // 瀏覽器端不知道目前的密碼，所以這裡合併而不是整包覆蓋：沒帶 pin 就保留原本的
        const current = (await redis.get("cfg")) || DEFAULTS.cfg;
        const next = { ...current, ...value };
        const pinChanged = typeof value?.pin === "string" && value.pin !== String(current.pin || "0000");
        if (pinChanged && value.pin.length < 4) {
          res.status(400).json({ error: "密碼至少 4 個字元" });
          return;
        }
        if (!pinChanged) next.pin = current.pin;
        await redis.set("cfg", next);
        if (pinChanged) {
          // 換密碼時讓所有舊的登入憑證失效（密碼外流後換掉，之前登入過的人也要被踢掉），並發一張新的給目前這位管理員
          await revokeAllAdminTokens(redis);
          res.status(200).json({ ok: true, token: await signAdminToken(redis) });
          return;
        }
      } else if (key === "forms") {
        // 新上傳或舊版畫面送來的內嵌照片，在這裡搬到獨立的 key
        await redis.set("forms", await externalizeImages(redis, value));
      } else {
        await redis.set(key, value);
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("state api error", e);
    res.status(500).json({ error: e.message || "伺服器錯誤" });
  }
}
