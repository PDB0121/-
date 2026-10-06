import crypto from "crypto";
import zlib from "zlib";

// 備份內容只有「錢」相關的資料：成員名單、全部交易紀錄，再附上算好的每人餘額與金庫總額方便直接看。
// 表單與訂單不備份（已結算的都已經在交易紀錄裡）。存之前用 gzip 壓縮，保留最近 30 份自動備份。

export const INDEX_KEY = "backup:index";
export const snapKey = (id) => `backup:snap:${id}`;
const KEEP_AUTO = 30;
const KEEP_OTHER = 10; // 手動備份 + 還原前留存，合計保留的份數
const MAX_USERS = 2000;
const MAX_TX = 50000;
export const ID_RE = /^[0-9TZ]+-(auto|manual|pre-restore)$/;

export function computeBalances(users, tx) {
  const bal = {};
  users.forEach((u) => { bal[u.id] = 0; });
  tx.forEach((t) => { bal[t.userId] = (bal[t.userId] || 0) + (Number(t.amount) || 0); });
  const balances = users.map((u) => ({ id: u.id, name: u.name, balance: bal[u.id] }));
  const vault = balances.reduce((s, b) => s + b.balance, 0);
  return { balances, vault };
}

export function buildSnapshot(state, kind, now = new Date()) {
  const users = Array.isArray(state.users) ? state.users : [];
  const tx = Array.isArray(state.tx) ? state.tx : [];
  const { balances, vault } = computeBalances(users, tx);
  return {
    app: "meal-order-app", version: 1, kind, createdAt: now.toISOString(),
    summary: { vault, members: users.length, txCount: tx.length },
    balances, users, tx,
  };
}

export const hashState = (state) =>
  crypto.createHash("sha256").update(JSON.stringify({ users: state.users || [], tx: state.tx || [] })).digest("hex");

const encode = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj), "utf8")).toString("base64");
const decode = (str) => JSON.parse(zlib.gunzipSync(Buffer.from(str, "base64")).toString("utf8"));

export async function readIndex(redis) {
  const idx = await redis.get(INDEX_KEY);
  return { lastRun: idx?.lastRun || null, items: Array.isArray(idx?.items) ? idx.items : [] };
}

export async function readSnapshot(redis, id) {
  if (!ID_RE.test(String(id))) return null;
  const raw = await redis.get(snapKey(id));
  if (!raw || typeof raw !== "string") return null;
  try { return decode(raw); } catch (e) { return null; }
}

// 存一份快照。dedupe 為 true 時，資料跟最新一份完全一樣就不存（回傳 saved:false）。
export async function saveSnapshot(redis, state, kind, { dedupe = false } = {}) {
  const idx = await readIndex(redis);
  const now = new Date();
  const snap = buildSnapshot(state, kind, now);
  const hash = hashState(state);

  if (dedupe && idx.items[0] && idx.items[0].hash === hash) {
    if (kind === "auto") { idx.lastRun = { at: snap.createdAt, result: "unchanged" }; await redis.set(INDEX_KEY, idx); }
    return { saved: false, reason: "unchanged" };
  }

  const id = `${snap.createdAt.replace(/[-:.]/g, "")}-${kind}`;
  const payload = encode(snap);
  await redis.set(snapKey(id), payload);
  const entry = { id, kind, createdAt: snap.createdAt, vault: snap.summary.vault, members: snap.summary.members, txCount: snap.summary.txCount, bytes: payload.length, hash };
  idx.items.unshift(entry);

  let nAuto = 0, nOther = 0;
  const keep = [], drop = [];
  for (const it of idx.items) {
    if (it.kind === "auto") (++nAuto <= KEEP_AUTO ? keep : drop).push(it);
    else (++nOther <= KEEP_OTHER ? keep : drop).push(it);
  }
  idx.items = keep;
  if (kind === "auto") idx.lastRun = { at: snap.createdAt, result: "saved", id };
  await redis.set(INDEX_KEY, idx);
  for (const it of drop) await redis.del(snapKey(it.id));
  return { saved: true, entry };
}

// 檢查要還原的備份內容長得對不對，回傳錯誤訊息（沒問題回傳 null）
export function validateSnapshot(snap) {
  if (!snap || typeof snap !== "object") return "備份檔格式不對。";
  if (snap.app !== "meal-order-app" || snap.version !== 1) return "這不是這個網站產生的備份檔，或版本不符。";
  if (!Array.isArray(snap.users) || !Array.isArray(snap.tx)) return "備份檔裡缺少成員或交易紀錄。";
  if (snap.users.length > MAX_USERS || snap.tx.length > MAX_TX) return "備份檔資料量異常，已拒絕。";
  const ids = new Set();
  for (const u of snap.users) {
    if (!u || typeof u.id !== "string" || !u.id || typeof u.name !== "string") return "備份檔裡有格式不對的成員資料。";
    if (ids.has(u.id)) return "備份檔裡有重複的成員。";
    ids.add(u.id);
  }
  for (const t of snap.tx) {
    if (!t || typeof t.id !== "string" || typeof t.userId !== "string" || typeof t.amount !== "number" || !Number.isFinite(t.amount)) {
      return "備份檔裡有格式不對的交易紀錄。";
    }
  }
  return null;
}

// 還原：先把「現在」的資料另存一份（萬一按錯可以還原回來），再用備份內容覆蓋成員與交易紀錄
export async function restoreSnapshot(redis, snap) {
  const err = validateSnapshot(snap);
  if (err) return { ok: false, error: err };
  const [users, tx] = await redis.mget("users", "tx");
  const current = { users: users || [], tx: tx || [] };
  const pre = await saveSnapshot(redis, current, "pre-restore");
  await redis.set("users", snap.users);
  await redis.set("tx", snap.tx);
  const { vault } = computeBalances(snap.users, snap.tx);
  return { ok: true, vault, members: snap.users.length, txCount: snap.tx.length, preRestoreId: pre.entry?.id };
}
