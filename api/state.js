import { Redis } from "@upstash/redis";

const KEYS = ["users", "forms", "tx", "cfg"];
const DEFAULTS = {
  users: [],
  forms: [],
  tx: [],
  cfg: { pin: "0000", title: "今天吃什麼" },
};

// Vercel 的 Marketplace Redis 整合（Upstash）用不同名稱注入環境變數，
// 依接的是哪個整合而定，這裡把常見的幾種都試一遍。
function getRedis() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

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
      const values = await Promise.all(KEYS.map((k) => redis.get(k)));
      const state = {};
      KEYS.forEach((k, i) => { state[k] = values[i] ?? DEFAULTS[k]; });
      res.status(200).json(state);
      return;
    }

    if (req.method === "POST") {
      const { key, value } = req.body || {};
      if (!KEYS.includes(key)) {
        res.status(400).json({ error: "無效的 key" });
        return;
      }
      await redis.set(key, value);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("state api error", e);
    res.status(500).json({ error: e.message || "伺服器錯誤" });
  }
}
