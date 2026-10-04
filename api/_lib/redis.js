import { Redis } from "@upstash/redis";

// Vercel 的 Marketplace Redis 整合（Upstash）依接的是哪個整合，環境變數名稱可能不同，這裡把常見的幾種都試一遍。
export function getRedis() {
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
