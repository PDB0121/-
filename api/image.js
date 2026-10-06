import { getRedis } from "./_lib/redis.js";
import { verifyAdminToken } from "./_lib/auth.js";
import { imgKey, decodeImage, isValidFormId } from "./_lib/forms.js";

// GET /api/image?id=<表單 id>&v=<版本>  讀取菜單照片（網址帶版本號，所以可以放心讓瀏覽器與 CDN 長期快取）
// DELETE /api/image?id=<表單 id>        管理員刪除照片（刪表單、移除照片時順手清掉）
export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) { res.status(500).json({ error: "找不到 Redis 連線資訊" }); return; }

  const id = String((req.query && req.query.id) || "");
  if (!isValidFormId(id)) { res.status(400).json({ error: "無效的 id" }); return; }

  try {
    if (req.method === "GET") {
      let data = await redis.get(imgKey(id));
      if (!data) {
        // 還沒搬家的舊表單：照片還內嵌在 forms 裡，順便複製一份到獨立的 key（只複製，不動 forms）
        const forms = (await redis.get("forms")) || [];
        const f = Array.isArray(forms) ? forms.find((x) => x && x.id === id) : null;
        if (f && typeof f.menuImage === "string" && f.menuImage) {
          data = f.menuImage;
          if (decodeImage(data)) await redis.set(imgKey(id), data);
        }
      }
      const img = decodeImage(data);
      if (!img) {
        res.setHeader("Cache-Control", "no-store");
        res.status(404).json({ error: "沒有這張照片" });
        return;
      }
      res.setHeader("Content-Type", img.mime);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
      res.status(200).send(img.buffer);
      return;
    }

    if (req.method === "DELETE") {
      const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!(await verifyAdminToken(redis, auth))) { res.status(401).json({ error: "需要管理員登入" }); return; }
      await redis.del(imgKey(id));
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("image api error", e);
    res.status(500).json({ error: e.message || "伺服器錯誤" });
  }
}
