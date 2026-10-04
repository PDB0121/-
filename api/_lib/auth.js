import crypto from "crypto";

const SECRET_KEY = "__admin_secret";
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

// 簽章用的密鑰不放在環境變數（省去使用者手動設定的步驟），
// 第一次需要時自動產生一組隨機值存進資料庫，之後重複使用。
async function getSecret(redis) {
  let secret = await redis.get(SECRET_KEY);
  if (!secret) {
    secret = crypto.randomBytes(32).toString("hex");
    await redis.set(SECRET_KEY, secret);
  }
  return secret;
}

// 換掉簽章密鑰，所有之前簽出去的憑證立刻失效
export async function revokeAllAdminTokens(redis) {
  await redis.del(SECRET_KEY);
}

export async function signAdminToken(redis) {
  const secret = await getSecret(redis);
  const payload = Buffer.from(JSON.stringify({ role: "admin", iat: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export async function verifyAdminToken(redis, token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const secret = await getSecret(redis);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.role !== "admin") return false;
    if (!data.iat || Date.now() - data.iat > TOKEN_MAX_AGE_MS) return false;
    return true;
  } catch (e) {
    return false;
  }
}
