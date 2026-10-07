import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Utensils, Users, Wallet, Receipt, Shield, User, RefreshCw, Plus, Minus,
  Trash2, Check, X, ChevronLeft, Upload, Loader2, ClipboardList, Calendar,
  Lock, LogOut, Settings, Search, FileText, ImageIcon, CircleDollarSign, Copy, Download, Edit3, Clock, ExternalLink, Eye, EyeOff,
} from "lucide-react";

/* ---------------- storage ----------------
   資料存在後端（Vercel KV），所有使用者共用同一份，透過 /api/state 讀寫。 */
const API_BASE = "/api";
const DEFAULT_STATE = { users: [], forms: [], tx: [], cfg: { title: "今天吃什麼" } };
const TOKEN_KEY = "meal_order_admin_token";

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || undefined; } catch (e) { return undefined; } };
const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無痕模式等情況存不了就算了 */ } };

// 密碼只在伺服器端比對，瀏覽器只拿到一張登入憑證
async function adminLogin(pin) {
  try {
    const res = await fetch(`${API_BASE}/admin-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) return { ok: false, error: data.error || "密碼不對" };
    setToken(data.token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "連線失敗，請稍後再試" };
  }
}

// 截止時間以伺服器的時間為準：每次讀資料時用回應的 Date 標頭算出「伺服器時間 - 本機時間」的差，
// 這樣就算訂餐者的手機時鐘不準，也不會提早或延後被鎖定。
let clockOffset = 0;
const serverNow = () => Date.now() + clockOffset;

async function fetchState() {
  try {
    const res = await fetch(`${API_BASE}/state`, { cache: "no-store" });
    if (!res.ok) throw new Error("讀取失敗 " + res.status);
    const serverDate = Date.parse(res.headers.get("date") || "");
    if (!Number.isNaN(serverDate)) clockOffset = serverDate - Date.now();
    const data = await res.json();
    return { ...DEFAULT_STATE, ...data };
  } catch (e) {
    console.error("讀取資料失敗", e);
    // 失敗就回傳 null，不要回傳空資料：拿空資料當基底去存檔會把現有的表單、訂單整個清掉
    return null;
  }
}

// 要拿來存檔的最新資料：讀取失敗就提示並回傳 null，呼叫的地方直接中止
async function fetchFresh() {
  const s = await fetchState();
  if (!s) await askNotice("連線失敗", "讀取最新資料失敗，這次的操作沒有儲存，請檢查網路後再試一次。");
  return s;
}
async function saveState(key, value) {
  try {
    const res = await fetch(`${API_BASE}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, token: getToken() }),
    });
    if (res.status === 401) {
      // 登入憑證過期或無效：畫面上的改動其實沒有存進去，重新載入讓畫面回到伺服器上的實際內容
      setToken(null);
      await askNotice("登入已過期", "剛剛的改動沒有儲存成功，請重新登入管理員後再操作一次。");
      window.location.reload();
      return false;
    }
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.token) setToken(data.token);
    }
    return res.ok;
  } catch (e) {
    console.error("儲存失敗", key, e);
    return false;
  }
}

/* ---------------- utils ---------------- */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
// 用「本地」日期（台灣 UTC+8）。用 toISOString 會是 UTC 日期，早上 8 點以前會變成前一天。
const localDate = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const today = () => localDate(new Date());
const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + n));
};
const money = (n) => (n < 0 ? "-" : "") + "NT$" + Math.abs(Math.round(n)).toLocaleString("en-US");
const lineKey = (l) => `${l.name}||${(l.note || "").trim()}`;

/* ---------------- 菜單照片與外部連結 ---------------- */
// 照片不放在每 12 秒同步一次的資料裡，表單只記「有照片」(hasImage) 與版本 (imgVer)，要顯示時才用網址載入、由瀏覽器快取。
// 剛上傳、還沒跟伺服器同步的照片會暫時帶著 menuImage（data URL）直接顯示。
const menuImageSrc = (f) => f.menuImage || (f.hasImage ? `${API_BASE}/image?id=${encodeURIComponent(f.id)}&v=${f.imgVer || 1}` : null);

// 只接受 http / https 的網址（資料庫裡的內容不能整個信任，避免 javascript: 之類的連結被點開）。沒寫開頭會自動補 https://
function safeUrl(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || s.length > 500) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/:]+\.[^/:]+:\d/.test(s); // "example.com:8080" 的冒號是連接埠，不是協定
  try {
    const url = new URL(hasScheme ? s : `https://${s}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch (e) {
    return null;
  }
}
const linkHost = (href) => { try { return new URL(href).hostname.replace(/^www\./, ""); } catch (e) { return href; } };

// 刪表單、移除照片時順手把伺服器上的照片也清掉（失敗也沒關係，只是多佔一點空間）
function deleteImageOnServer(formId) {
  const token = getToken();
  if (!token) return;
  fetch(`${API_BASE}/image?id=${encodeURIComponent(formId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

/* ---------------- 管理員專用 API 與備份檔 ---------------- */
// 呼叫需要管理員登入的 API（備份）。憑證過期就提示並重新載入。
async function adminApi(path, { method = "GET", body } = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method, cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() || ""}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      setToken(null);
      await askNotice("登入已過期", "請重新登入管理員後再操作一次。");
      window.location.reload();
      return { ok: false, status: 401, data: {} };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: "連線失敗，請檢查網路後再試一次。" } };
  }
}

// JSON 備份檔不能加 BOM（有 BOM 的 JSON 有些程式讀不進去）
function downloadJson(filename, obj) {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) { return false; }
}

const LAST_DOWNLOAD_KEY = "meal_order_last_backup_download";
const BACKUP_KIND = { auto: "每日自動", manual: "手動", "pre-restore": "還原前自動留存" };
const fmtDateTime = (iso) => new Date(iso).toLocaleString("zh-TW", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const fileStamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

/* ---------------- 表單截止時間 ---------------- */
const deadlinePassed = (f, now) => !!f.deadline && now >= Date.parse(f.deadline);
const formClosed = (f, now) => !!f.closed || deadlinePassed(f, now);

// 每秒更新一次的「現在時間」（伺服器時間），讓截止時間一到畫面就自動鎖定
function useNow() {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const i = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(i);
  }, []);
  return now;
}

const fmtDeadline = (iso) => new Date(iso).toLocaleString("zh-TW", {
  month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

function fmtRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小時`;
  if (h > 0) return `${h} 小時 ${m} 分`;
  return `${m} 分 ${s % 60} 秒`;
}

// <input type="datetime-local"> 要的是本地時間的 "YYYY-MM-DDTHH:mm"
const toLocalInput = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 只改動這一張表單：先抓最新資料再改，避免拿畫面上可能過期的整包資料蓋掉別人剛送出的訂單
async function updateFormFresh(saveForms, formId, mutate) {
  const fresh = await fetchFresh();
  if (!fresh) return false;
  const f = fresh.forms.find((x) => x.id === formId);
  if (!f) { await askNotice("找不到這張表單", "這張表單可能已經被刪除了，請返回重新整理。"); return false; }
  if (f.settled) { await askNotice("表單已經結算", "已結算的表單不能再更改。"); return false; }
  await saveForms(fresh.forms.map((x) => (x.id === formId ? mutate(x) : x)));
  return true;
}

// 統計排序：名稱互相包含的品項（例如「碗粿」與「招牌碗粿」）排在一起，較短的在前；不合併，各自份數與備註照舊。
// 單一個字的名稱不拿來比對，避免「茶」「飯」這種太短的字把不相干的品項串在一起。
function sortStatsBySimilarName(list) {
  const cmp = (a, b) => a.localeCompare(b, "zh-Hant");
  const names = [...new Set(list.map((r) => r.name))];
  const parent = new Map(names.map((n) => [n, n]));
  const find = (n) => { while (parent.get(n) !== n) n = parent.get(n); return n; };
  names.forEach((a) => names.forEach((b) => {
    if (a !== b && a.length >= 2 && b.includes(a)) parent.set(find(b), find(a));
  }));
  const anchor = new Map();
  names.forEach((n) => {
    const root = find(n);
    const cur = anchor.get(root);
    if (!cur || n.length < cur.length || (n.length === cur.length && cmp(n, cur) < 0)) anchor.set(root, n);
  });
  const anchorOf = (n) => anchor.get(find(n));
  return [...list].sort((x, y) =>
    cmp(anchorOf(x.name), anchorOf(y.name)) ||
    x.name.length - y.name.length ||
    cmp(x.name, y.name) ||
    cmp(x.note, y.note));
}

function useDebouncedSave(fn, delay = 400) {
  const t = useRef(null);
  return useCallback((...args) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

/* ---------------- 主色調 ----------------
   使用者指定主色 #FFAD86（珊瑚橘）。因為這個色階不在 Tailwind 內建色盤裡，
   用一段全域 CSS 定義色階變數與需要 hover/focus 的樣式，其餘版面仍用 Tailwind
   的中性色（stone）與警示色（red）。 */
function BrandStyles() {
  return (
    <style>{`
      :root {
        --brand: #FFAD86;
        --brand-solid: #E2703E;
        --brand-solid-hover: #C85C30;
        --brand-solid-dark: #A84A26;
        --brand-tint: #FFE6D8;
        --brand-page: #FFF4EE;
        --brand-accent-hover: #FFC29E;
        --brand-ondark: #FFE0CC;
        --brand-ondark-strong: #FFF7F2;
      }
      .mo-bg-page { background-color: var(--brand-page); }
      .mo-bg-solid { background-color: var(--brand-solid); }
      .mo-border-solid { border-color: var(--brand-solid); }
      .mo-border-solid-dark { border-color: var(--brand-solid-dark); }
      .mo-icon-accent { color: var(--brand); }
      .mo-text-ondark { color: var(--brand-ondark); }
      .mo-text-ondark-strong { color: var(--brand-ondark-strong); }
      .mo-text-strong { color: var(--brand-solid-dark); }
      .mo-text-mid { color: var(--brand-solid); }
      .mo-badge { background-color: var(--brand-tint); color: var(--brand-solid-dark); }
      .mo-chip-solid { background-color: var(--brand-solid); color: #fff; }
      .mo-header-badge { background-color: var(--brand-solid-hover); color: var(--brand-ondark); }
      .mo-icon-btn:hover { background-color: var(--brand-solid-hover); }
      .mo-tab-active { border-color: var(--brand); color: var(--brand-ondark-strong); }
      .mo-tab-inactive { color: var(--brand-ondark); }
      .mo-tab-inactive:hover { color: var(--brand-ondark-strong); }
      .mo-bottomnav-active { color: var(--brand-solid-dark); }
      .mo-btn-solid { background-color: var(--brand-solid); color: #fff; }
      .mo-btn-solid:hover { background-color: var(--brand-solid-hover); }
      .mo-btn-accent { background-color: var(--brand); color: #4a2a17; }
      .mo-btn-accent:hover { background-color: var(--brand-accent-hover); }
      .mo-outline-dark { border-color: rgba(255,255,255,0.35); color: var(--brand-ondark-strong); }
      .mo-outline-dark:hover { background-color: var(--brand-solid-hover); }
      .mo-hover-card:hover { border-color: var(--brand-solid) !important; background-color: var(--brand-page); }
      .mo-hover-border:hover { border-color: var(--brand-solid) !important; }
      .mo-focus-input:focus { border-color: var(--brand-solid); outline: none; box-shadow: 0 0 0 1px var(--brand-solid); }
      .mo-focus-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand-solid), 0 0 0 4px #fff; }
    `}</style>
  );
}

/* ---------------- shared UI ---------------- */
function Btn({ children, onClick, variant = "solid", size = "md", disabled, className = "", type }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none mo-focus-btn disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2.5 text-sm", lg: "px-5 py-3 text-base" };
  const variants = {
    solid: "mo-btn-solid",
    accent: "mo-btn-accent",
    quiet: "bg-white text-stone-700 border border-stone-300 hover:bg-stone-50",
    ghost: "text-stone-600 hover:bg-stone-200",
    danger: "bg-white text-red-800 border border-red-300 hover:bg-red-50",
  };
  return (
    <button type={type || "button"} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-stone-700 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-stone-500 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 focus:outline-none mo-focus-input";

function Panel({ children, className = "" }) {
  return <div className={`rounded-xl border border-stone-200 bg-white ${className}`}>{children}</div>;
}

function Empty({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="mb-4 rounded-full bg-stone-100 p-4 text-stone-400"><Icon size={28} /></div>
      <p className="text-base font-medium text-stone-800">{title}</p>
      {hint && <p className="mt-1.5 max-w-sm text-sm text-stone-500">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function Money({ v, strong }) {
  const cls = v < 0 ? "text-red-800" : v > 0 ? "mo-text-strong" : "text-stone-600";
  return <span className={`tabular-nums ${strong ? "font-semibold" : ""} ${cls}`}>{money(v)}</span>;
}

function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900 bg-opacity-50 p-0 sm:items-center sm:p-6">
      <div className={`max-h-full w-full overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`}>
        <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4">
          <h3 className="text-base font-semibold text-stone-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"><X size={18} /></button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- 確認對話框 ---------------- */
let _ask = null;
function askConfirm(opts) {
  if (typeof opts === "string") opts = { title: opts };
  if (!_ask) return Promise.resolve(true);
  return _ask({ confirmLabel: "確定", cancelLabel: "取消", ...opts });
}
function askNotice(title, body) {
  return askConfirm({ title, body, noticeOnly: true, confirmLabel: "知道了" });
}

function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => {
    _ask = (opts) => new Promise((resolve) => setState({ opts, resolve }));
    return () => { _ask = null; };
  }, []);
  const close = (v) => { if (state) state.resolve(v); setState(null); };
  if (!state) return null;
  const o = state.opts;
  return (
    <Modal open onClose={() => close(false)} title={o.title}>
      {o.body && <div className="whitespace-pre-line text-sm leading-relaxed text-stone-600">{o.body}</div>}
      <div className="mt-6 flex justify-end gap-2">
        {!o.noticeOnly && <Btn variant="quiet" onClick={() => close(false)}>{o.cancelLabel}</Btn>}
        <Btn variant={o.danger ? "danger" : "solid"} onClick={() => close(true)}>{o.confirmLabel}</Btn>
      </div>
    </Modal>
  );
}

/* ---------------- 複製與匯出 ---------------- */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* 部分瀏覽器可能擋下，改用備援 */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

function downloadText(filename, text, mime) {
  try {
    const blob = new Blob(["﻿" + text], { type: (mime || "text/plain") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) { return false; }
}

/* 複製按鈕：瀏覽器擋下剪貼簿時，改開視窗讓使用者自己全選複製 */
function CopyButton({ text, label, variant = "quiet", size = "sm", filename, mime }) {
  const [state, setState] = useState("idle");
  const [fallback, setFallback] = useState(false);
  const run = async () => {
    const ok = await copyText(text);
    if (ok) { setState("done"); setTimeout(() => setState("idle"), 2000); }
    else setFallback(true);
  };
  return (
    <>
      <Btn variant={variant} size={size} onClick={run}>
        {state === "done" ? <><Check size={14} />已複製</> : <><Copy size={14} />{label}</>}
      </Btn>
      <TextModal open={fallback} onClose={() => setFallback(false)} text={text} filename={filename} mime={mime} />
    </>
  );
}

function TextModal({ open, onClose, text, filename, mime }) {
  const ref = useRef(null);
  return (
    <Modal open={open} onClose={onClose} title="全選以下內容複製" wide>
      <p className="mb-3 text-sm text-stone-500">瀏覽器擋下了自動複製，請手動全選後複製。</p>
      <textarea ref={ref} readOnly value={text} rows={12}
        onFocus={(e) => e.target.select()}
        className="w-full rounded-lg border border-stone-300 bg-stone-50 p-3 font-mono text-sm text-stone-800" />
      <div className="mt-4 flex justify-end gap-2">
        <Btn variant="quiet" onClick={() => ref.current && ref.current.select()}>全選</Btn>
        {filename && <Btn variant="quiet" onClick={() => downloadText(filename, text, mime)}><Download size={14} />下載檔案</Btn>}
        <Btn onClick={onClose}>關閉</Btn>
      </div>
    </Modal>
  );
}

function toCsv(rows) {
  return rows.map((r) => r.map((c) => {
    const v = c === null || c === undefined ? "" : String(c);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(",")).join("\n");
}

/* ---------------- 品項編輯（新增表單與事後修改共用） ---------------- */
function ItemRows({ items, setItems, emptyHint }) {
  const patch = (id, p) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const drop = (id) => setItems((prev) => prev.filter((i) => i.id !== id));
  const add = () => setItems((prev) => [...prev, { id: uid(), name: "", price: "", group: "" }]);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-stone-700">品項與價格（{items.length}）</span>
        <Btn size="sm" variant="quiet" onClick={add}><Plus size={14} />手動加一項</Btn>
      </div>
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {items.map((i) => (
          <div key={i.id} className="rounded-lg border border-stone-200 p-2.5">
            <div className="flex items-center gap-2">
              <input className={inputCls + " min-w-0 flex-1 font-medium"} value={i.name} placeholder="品項名稱，例如：招牌焢肉飯"
                onChange={(e) => patch(i.id, { name: e.target.value })} />
              <button onClick={() => drop(i.id)} title="刪除這一項"
                className="shrink-0 rounded-lg px-2 py-2 text-stone-400 hover:bg-red-50 hover:text-red-800"><Trash2 size={16} /></button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="shrink-0 text-xs text-stone-500">價格</span>
              <input className={inputCls + " w-28 tabular-nums"} inputMode="decimal" value={i.price === 0 ? "0" : String(i.price ?? "")}
                placeholder="0" onFocus={(e) => e.target.select()}
                onChange={(e) => patch(i.id, { price: e.target.value.replace(/[^0-9.]/g, "") })} />
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="py-6 text-center text-sm text-stone-500">{emptyHint || "還沒有品項"}</p>}
      </div>
    </div>
  );
}

/* 把原圖縮小成適合長期保存在共用儲存空間的大小，避免多張表單疊起來超過容量上限 */
function resizeImage(dataUrl, maxDim = 1280, quality = 0.72) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      try { resolve(canvas.toDataURL("image/jpeg", quality)); }
      catch (e) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* 菜單原圖：縮圖 + 點擊放大 */
function MenuImage({ src, className, label }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`group block overflow-hidden rounded-lg border border-stone-200 ${className || ""}`}>
        <img src={src} alt="菜單照片" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={label || "菜單照片"} wide>
        <img src={src} alt="菜單照片" className="w-full rounded-lg" />
      </Modal>
    </>
  );
}

/* 表單的外部連結（店家菜單、地圖、訂餐網頁…），另開分頁 */
function FormLink({ href, className = "" }) {
  const url = safeUrl(href);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 ${className}`}>
      <ExternalLink size={14} className="shrink-0" />
      <span className="truncate">外部連結：{linkHost(url)}</span>
    </a>
  );
}

/* 訂餐頁用的菜單照片：整條顯示，點擊放大 */
function MenuImageBanner({ src }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <Panel className="mb-5 overflow-hidden">
      <button type="button" onClick={() => setOpen(true)} className="block w-full bg-stone-50">
        <img src={src} alt="菜單照片" className="mx-auto max-h-64 w-full object-contain" />
      </button>
      <p className="border-t border-stone-100 px-4 py-2 text-center text-xs text-stone-500">點圖放大看菜單原圖</p>
      <Modal open={open} onClose={() => setOpen(false)} title="菜單照片" wide>
        <img src={src} alt="菜單照片" className="w-full rounded-lg" />
      </Modal>
    </Panel>
  );
}

/* ================= APP ================= */
export default function MealOrderApp() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [forms, setForms] = useState([]);
  const [txs, setTxs] = useState([]);
  const [cfg, setCfg] = useState({ title: "今天吃什麼" });

  const [role, setRole] = useState(null);       // 'admin' | 'user'
  const [meId, setMeId] = useState(null);
  const [tab, setTab] = useState("forms");
  const [openFormId, setOpenFormId] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async (silent) => {
    if (!silent) setSyncing(true);
    const s = await fetchState();
    if (!s) { setSyncing(false); setLoading(false); return; } // 暫時連不上就保留畫面上現有的資料
    setUsers(s.users); setForms(s.forms); setTxs(s.tx); setCfg(s.cfg);
    setSyncedAt(new Date());
    setSyncing(false);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(true); }, [refresh]);

  // 即時同步：分頁在前景時每 12 秒拉一次，讓多人填的表單會自動彙整進來；
  // 切到背景分頁就暫停，省掉閒置分頁白打的請求，切回來時立刻補拉一次。
  useEffect(() => {
    let timer = null;
    const start = () => { if (!timer) timer = setInterval(() => refresh(true), 12000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") { refresh(true); start(); }
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibilityChange); };
  }, [refresh]);

  const saveUsers = async (next) => { setUsers(next); await saveState("users", next); };
  const saveForms = async (next) => { setForms(next); await saveState("forms", next); };
  const saveTxs = async (next) => { setTxs(next); await saveState("tx", next); };
  const saveCfg = async (next) => { setCfg({ title: next.title }); await saveState("cfg", next); };

  const balances = useMemo(() => {
    const m = {};
    users.forEach((u) => { m[u.id] = 0; });
    txs.forEach((t) => { m[t.userId] = (m[t.userId] || 0) + t.amount; });
    return m;
  }, [users, txs]);

  if (loading) {
    return (
      <>
        <BrandStyles />
        <div className="flex min-h-screen items-center justify-center mo-bg-page">
          <Loader2 className="animate-spin mo-text-strong" size={28} />
        </div>
      </>
    );
  }

  if (!role) {
    return (
      <>
        <BrandStyles />
        <Gate users={users} cfg={cfg} onAdmin={() => { setRole("admin"); setTab("forms"); }}
          onUser={(id) => { setRole("user"); setMeId(id); setTab("order"); }} />
      </>
    );
  }

  const me = users.find((u) => u.id === meId);
  if (role === "user" && !me) { setRole(null); return null; }

  const navAdmin = [
    { id: "forms", label: "訂餐表單", icon: ClipboardList },
    { id: "daily", label: "結算統計", icon: Calendar },
    { id: "people", label: "成員儲值", icon: Users },
    { id: "ledger", label: "扣款明細", icon: Receipt },
    { id: "settings", label: "設定", icon: Settings },
  ];
  const navUser = [
    { id: "order", label: "我要訂餐", icon: Utensils },
    { id: "wallet", label: "我的帳戶", icon: Wallet },
  ];
  const nav = role === "admin" ? navAdmin : navUser;

  const exit = () => { setToken(null); setRole(null); setMeId(null); setOpenFormId(null); };

  return (
    <div className="min-h-screen mo-bg-page pb-20 text-stone-900 sm:pb-0">
      <BrandStyles />
      <ConfirmHost />
      <header className="sticky top-0 z-30 border-b mo-border-solid-dark mo-bg-solid">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Utensils className="mo-icon-accent" size={20} />
          <span className="text-base font-semibold tracking-tight mo-text-ondark-strong">{cfg.title || "今天吃什麼"}</span>
          <span className="rounded-md mo-header-badge px-2 py-0.5 text-xs">
            {role === "admin" ? "管理員" : me.name}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {role === "user" && (
              <span className="mr-1 hidden text-sm mo-text-ondark sm:inline">
                餘額 <span className="tabular-nums font-semibold text-white">{money(balances[me.id] || 0)}</span>
              </span>
            )}
            <button onClick={() => refresh(false)} title="重新整理" className="mo-icon-btn rounded-lg p-2 mo-text-ondark">
              <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
            </button>
            <button onClick={exit} title="離開" className="mo-icon-btn rounded-lg p-2 mo-text-ondark">
              <LogOut size={16} />
            </button>
          </div>
        </div>
        <nav className="mx-auto hidden max-w-5xl gap-1 px-2 sm:flex">
          {nav.map((n) => (
            <button key={n.id} onClick={() => { setTab(n.id); setOpenFormId(null); }}
              className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${tab === n.id ? "mo-tab-active" : "border-transparent mo-tab-inactive"}`}>
              <n.icon size={15} />{n.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {role === "admin" && tab === "forms" && (
          openFormId
            ? <AdminFormDetail form={forms.find((f) => f.id === openFormId)} users={users} balances={balances}
                onBack={() => setOpenFormId(null)} saveForms={saveForms} forms={forms} txs={txs} saveTxs={saveTxs} />
            : <AdminForms forms={forms} saveForms={saveForms} onOpen={setOpenFormId} />
        )}
        {role === "admin" && tab === "daily" && <DailySettlement forms={forms} txs={txs} users={users} />}
        {role === "admin" && tab === "people" && <People users={users} balances={balances} txs={txs} saveUsers={saveUsers} saveTxs={saveTxs} onRefresh={() => refresh(false)} />}
        {role === "admin" && tab === "ledger" && <AdminLedger txs={txs} users={users} onRefresh={() => refresh(false)} />}
        {role === "admin" && tab === "settings" && <SettingsPane cfg={cfg} saveCfg={saveCfg} onWipe={async () => { await saveForms([]); await saveTxs([]); await saveUsers([]); }} />}

        {role === "user" && tab === "order" && (
          openFormId
            ? <OrderEditor form={forms.find((f) => f.id === openFormId)} me={me} forms={forms} saveForms={saveForms}
                onBack={() => setOpenFormId(null)} balance={balances[me.id] || 0} />
            : <UserForms forms={forms} me={me} onOpen={setOpenFormId} />
        )}
        {role === "user" && tab === "wallet" && <UserWallet me={me} txs={txs} balance={balances[me.id] || 0} />}

        {syncedAt && (
          <p className="mt-8 text-center text-xs text-stone-400">
            最後同步 {syncedAt.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}，畫面開著時每 12 秒自動更新
          </p>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-stone-200 bg-white sm:hidden">
        {nav.map((n) => (
          <button key={n.id} onClick={() => { setTab(n.id); setOpenFormId(null); }}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs ${tab === n.id ? "mo-bottomnav-active" : "text-stone-500"}`}>
            <n.icon size={18} />{n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ---------------- 進入畫面 ---------------- */
function Gate({ users, cfg, onAdmin, onUser }) {
  const [mode, setMode] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);
  const [q, setQ] = useState("");

  // 被管理員隱藏的成員不會出現在「我是誰」的名單裡（管理員端仍看得到、操作得到）
  const visible = users.filter((u) => !u.hidden);
  const list = visible.filter((u) => u.name.includes(q));

  const tryAdminLogin = async () => {
    if (checking) return;
    setErr(""); setChecking(true);
    const r = await adminLogin(pin);
    setChecking(false);
    if (r.ok) onAdmin(); else setErr(r.error);
  };

  return (
    <div className="min-h-screen mo-bg-solid px-5 py-14">
      <div className="mx-auto max-w-md">
        <div className="mb-10">
          <Utensils className="mb-5 mo-icon-accent" size={34} />
          <h1 className="text-4xl font-semibold leading-tight tracking-tight mo-text-ondark-strong">
            {cfg.title || "今天吃什麼"}
          </h1>
          <p className="mt-3 text-base leading-relaxed mo-text-ondark">
            大家填單、系統算錢、訂完直接扣儲值金。
          </p>
        </div>

        {!mode && (
          <div className="space-y-3">
            <button onClick={() => setMode("user")}
              className="flex w-full items-center gap-4 rounded-xl mo-btn-accent px-5 py-5 text-left">
              <User size={24} />
              <span>
                <span className="block text-lg font-semibold">我要訂餐</span>
                <span className="block text-sm mo-text-strong">填單、查自己的餘額與扣款</span>
              </span>
            </button>
            <button onClick={() => setMode("admin")}
              className="flex w-full items-center gap-4 rounded-xl border mo-outline-dark px-5 py-5 text-left">
              <Shield size={24} className="mo-icon-accent" />
              <span>
                <span className="block text-lg font-semibold">管理員</span>
                <span className="block text-sm mo-text-ondark">開表單、彙整品項、儲值與結帳</span>
              </span>
            </button>
          </div>
        )}

        {mode === "admin" && (
          <div className="rounded-xl bg-white p-5">
            <Field label="管理員密碼">
              <input className={inputCls} type="password" value={pin} autoFocus
                onChange={(e) => { setPin(e.target.value); setErr(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") tryAdminLogin(); }}
                placeholder="輸入管理員密碼" />
            </Field>
            {err && <p className="mt-2 text-sm text-red-800">{err}</p>}
            <div className="mt-4 flex gap-2">
              <Btn variant="quiet" onClick={() => setMode(null)}>返回</Btn>
              <Btn className="flex-1" disabled={checking} onClick={tryAdminLogin}>{checking ? "確認中…" : "進入管理"}</Btn>
            </div>
          </div>
        )}

        {mode === "user" && (
          <div className="rounded-xl bg-white p-5">
            {visible.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-stone-600">{users.length === 0 ? "還沒有任何訂餐者。請管理員先到「成員儲值」建立名單。" : "目前沒有開放選擇的成員，請聯絡管理員。"}</p>
                <div className="mt-4"><Btn variant="quiet" onClick={() => setMode(null)}>返回</Btn></div>
              </div>
            ) : (
              <>
                <Field label="你是誰？">
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-3 text-stone-400" />
                    <input className={inputCls + " pl-9"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="輸入名字找自己" />
                  </div>
                </Field>
                <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
                  {list.map((u) => (
                    <button key={u.id} onClick={() => onUser(u.id)}
                      className="flex w-full items-center justify-between rounded-lg border border-stone-200 px-4 py-3 text-left text-sm mo-hover-card">
                      <span className="font-medium">{u.name}</span>
                      <span className="text-xs text-stone-500">{u.dept || ""}</span>
                    </button>
                  ))}
                  {list.length === 0 && <p className="py-4 text-center text-sm text-stone-500">找不到這個名字</p>}
                </div>
                <div className="mt-4"><Btn variant="quiet" onClick={() => setMode(null)}>返回</Btn></div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 管理員：表單列表 ---------------- */
function AdminForms({ forms, saveForms, onOpen }) {
  const [creating, setCreating] = useState(false);
  const now = useNow();
  const sorted = [...forms].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  const remove = async (id) => {
    const ok = await askConfirm({ title: "刪除這張表單？", body: "表單與裡面的訂單會消失。已結算的扣款紀錄會保留在扣款明細裡。", danger: true, confirmLabel: "刪除表單" });
    if (!ok) return;
    const fresh = await fetchFresh();
    if (!fresh) return;
    await saveForms(fresh.forms.filter((f) => f.id !== id));
    deleteImageOnServer(id);
  };

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">訂餐表單</h2>
          <p className="mt-1 text-sm text-stone-500">可以同時開多張，每張獨立記帳。</p>
        </div>
        <Btn onClick={() => setCreating(true)}><Plus size={16} />新增表單</Btn>
      </div>

      {sorted.length === 0 ? (
        <Panel><Empty icon={ClipboardList} title="還沒有表單"
          hint="建立一張表單，可以附上菜單照片給大家對照，也可以設定截止時間。"
          action={<Btn onClick={() => setCreating(true)}><Plus size={16} />新增表單</Btn>} /></Panel>
      ) : (
        <div className="space-y-3">
          {sorted.map((f) => {
            const total = f.orders.reduce((s, o) => s + o.total, 0);
            return (
              <Panel key={f.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={() => onOpen(f.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-stone-900">{f.title}</span>
                      {f.settled
                        ? <span className="shrink-0 rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-500">已結算</span>
                        : formClosed(f, now)
                          ? <span className="shrink-0 rounded-md bg-stone-200 px-2 py-0.5 text-xs text-stone-600">已截止</span>
                          : <span className="shrink-0 rounded-md mo-chip-solid px-2 py-0.5 text-xs">收單中</span>}
                    </div>
                    <p className="mt-1 text-sm text-stone-500 tabular-nums">
                      {f.date}　{f.orders.length} 人已填　合計 {money(total)}
                    </p>
                    {f.deadline && !f.settled && (
                      <p className="mt-0.5 text-xs text-stone-400">
                        截止 {fmtDeadline(f.deadline)}{!formClosed(f, now) && `（剩 ${fmtRemaining(Date.parse(f.deadline) - now)}）`}
                      </p>
                    )}
                  </button>
                  <Btn size="sm" variant="quiet" onClick={() => onOpen(f.id)}>查看</Btn>
                  <button onClick={() => remove(f.id)} className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-800"><Trash2 size={16} /></button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <CreateForm open={creating} onClose={() => setCreating(false)} onCreate={async (form) => {
        const fresh = await fetchState();
        if (!fresh) return { error: "讀取最新資料失敗，這張表單還沒有建立，請檢查網路後再試一次。" };
        await saveForms([form, ...fresh.forms]); setCreating(false);
      }} />
    </div>
  );
}

/* 截止時間輸入：日期時間欄位加幾個常用的「幾分鐘後」快速按鈕 */
function DeadlineField({ value, onChange }) {
  const after = (min) => onChange(toLocalInput(serverNow() + min * 60000));
  return (
    <div>
      <input type="datetime-local" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Btn size="sm" variant="quiet" onClick={() => after(30)}>30 分鐘後</Btn>
        <Btn size="sm" variant="quiet" onClick={() => after(60)}>1 小時後</Btn>
        <Btn size="sm" variant="quiet" onClick={() => after(120)}>2 小時後</Btn>
        {value && <Btn size="sm" variant="ghost" onClick={() => onChange("")}>清除</Btn>}
      </div>
    </div>
  );
}

// 把欄位的值轉成 ISO 字串；沒填回傳 null；時間不合法或已經過了回傳 { error }
function parseDeadline(value) {
  if (!value) return { iso: null };
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return { error: "截止時間格式不對。" };
  if (t <= serverNow()) return { error: "這個時間已經過了，請設定之後的時間，或清除不設定。" };
  return { iso: new Date(t).toISOString() };
}

/* ---------------- 建立表單 ---------------- */
function CreateForm({ open, onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [deadline, setDeadline] = useState("");
  const [link, setLink] = useState("");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) { setTitle(""); setDate(today()); setDeadline(""); setLink(""); setItems([]); setErr(""); setPreview(null); }
  }, [open]);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setErr(""); setBusy(true);
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("讀取圖片失敗"));
        r.readAsDataURL(file);
      });
      const compressed = await resizeImage(dataUrl);
      setPreview(compressed || dataUrl);
    } catch (e2) {
      setErr("圖片讀取失敗：" + e2.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const create = async () => {
    const d = parseDeadline(deadline);
    if (d.error) return setErr(d.error);
    const linkUrl = link.trim() ? safeUrl(link) : null;
    if (link.trim() && !linkUrl) return setErr("外部連結的格式不對，請貼上 http:// 或 https:// 開頭的網址。");
    const clean = items.filter((i) => i.name.trim());
    const r = await onCreate({
      id: uid(), title: title.trim() || date, date, createdAt: new Date().toISOString(),
      items: clean.map((i) => ({ ...i, name: i.name.trim(), price: Number(i.price) || 0 })),
      // 照片先隨表單一起送出，伺服器收到後會搬到獨立的 key
      orders: [], closed: false, settled: false, menuImage: preview || null, deadline: d.iso, link: linkUrl,
    });
    if (r && r.error) setErr(r.error);
  };

  return (
    <Modal open={open} onClose={onClose} title="新增訂餐表單" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="表單名稱"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：阿姨自助餐" /></Field>
        <Field label="訂餐日期"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>

      <div className="mt-4">
        <span className="mb-1.5 block text-sm font-medium text-stone-700">截止時間（可留空）</span>
        <DeadlineField value={deadline} onChange={(v) => { setDeadline(v); setErr(""); }} />
        <span className="mt-1 block text-xs text-stone-500">時間一到，訂餐者就不能再填或修改，不用手動按「停止收單」。</span>
      </div>

      <div className="mt-4">
        <Field label="外部連結（可留空）" hint="例如店家的線上菜單、Google 地圖或訂餐網頁，訂餐者填單時可以直接點開。">
          <input className={inputCls} inputMode="url" value={link} placeholder="https://"
            onChange={(e) => { setLink(e.target.value); setErr(""); }} />
        </Field>
      </div>

      <div className="mt-5 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-5 text-center">
        {preview && <img src={preview} alt="菜單" className="mx-auto mb-4 max-h-48 rounded-lg" />}
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" id="menu-file" />
        <Btn variant="accent" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
          {busy ? <><Loader2 size={16} className="animate-spin" />處理中</> : <><Upload size={16} />上傳菜單照片</>}
        </Btn>
        <p className="mt-2 text-xs text-stone-500">拍一張菜單方便大家填單時對照，品項與價格請在下面手動輸入。</p>
      </div>

      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}

      <div className="mt-5">
        <ItemRows items={items} setItems={setItems} emptyHint="還沒有品項，手動加入" />
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={onClose}>取消</Btn>
        <Btn onClick={create}>建立表單</Btn>
      </div>
    </Modal>
  );
}

/* ---------------- 管理員：表單詳情 ---------------- */
function AdminFormDetail({ form, users, balances, onBack, forms, saveForms, txs, saveTxs }) {
  const [view, setView] = useState("items");
  const [editingMenu, setEditingMenu] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [settingDeadline, setSettingDeadline] = useState(false);
  const now = useNow();

  // 品項統計：相同品項不同備註分開算
  const stats = useMemo(() => {
    const m = new Map();
    (form ? form.orders : []).forEach((o) => {
      o.lines.forEach((l) => {
        const k = lineKey(l);
        if (!m.has(k)) m.set(k, { name: l.name, note: (l.note || "").trim(), price: l.price, qty: 0, who: [] });
        const rec = m.get(k);
        rec.qty += l.qty;
        rec.who.push(`${o.userName}×${l.qty}`);
      });
    });
    return sortStatsBySimilarName([...m.values()]);
  }, [form]);

  if (!form) return <Empty icon={FileText} title="找不到這張表單" action={<Btn onClick={onBack}>返回</Btn>} />;

  const total = form.orders.reduce((s, o) => s + o.total, 0);

  // 打電話念的版本：一行一個品項，備註不同會分開列
  // 同名稱的品項合併成一組先報總份數，底下再列各種備註各幾份（stats 已依名稱排序，同名會相鄰）
  const nameGroups = [];
  stats.forEach((s) => {
    const last = nameGroups[nameGroups.length - 1];
    if (last && last.name === s.name) { last.qty += s.qty; last.variants.push(s); }
    else nameGroups.push({ name: s.name, qty: s.qty, variants: [s] });
  });
  const phoneLines = nameGroups.flatMap((g) => {
    if (g.variants.length === 1 && !g.variants[0].note) return [`${g.name} ${g.qty} 份`];
    return [`${g.name} 共 ${g.qty} 份`, ...g.variants.map((v) => `　${v.qty} 份：${v.note || "無備註"}`)];
  });

  const phoneText = [
    `${form.title}　${form.date}`,
    "",
    ...phoneLines,
    "",
    `共 ${stats.reduce((n, s) => n + s.qty, 0)} 份，金額 ${money(total)}`,
  ].join("\n");

  const statsRows = [
    ["品項", "備註", "數量", "單價", "小計", "誰點的"],
    ...stats.map((s) => [s.name, s.note, s.qty, s.price, s.qty * s.price, s.who.join(" ")]),
    ["合計", "", stats.reduce((n, s) => n + s.qty, 0), "", total, ""],
  ];
  const statsTsv = statsRows.map((r) => r.join("\t")).join("\n");
  const statsCsv = toCsv(statsRows);

  const isClosed = formClosed(form, now);
  const isPastDeadline = deadlinePassed(form, now);

  const toggleClosed = async () => {
    if (!isClosed) {
      await updateFormFresh(saveForms, form.id, (f) => ({ ...f, closed: true }));
      return;
    }
    if (isPastDeadline) {
      const ok = await askConfirm({
        title: "重新開放填單？",
        body: "截止時間已經過了，重新開放會清除原本的截止時間，之後可以再設定新的。",
        confirmLabel: "重新開放",
      });
      if (!ok) return;
    }
    // 截止時間已過就一併清掉，不然重新開放後馬上又被鎖住
    await updateFormFresh(saveForms, form.id, (f) => ({ ...f, closed: false, deadline: deadlinePassed(f, serverNow()) ? null : f.deadline }));
  };

  const saveDeadline = async (iso) => {
    setSettingDeadline(false);
    await updateFormFresh(saveForms, form.id, (f) => ({ ...f, deadline: iso }));
  };

  const settle = async () => {
    if (form.settled) return;
    // 結算前先重新抓一次最新資料：避免用畫面上舊的訂單清單結算，漏掉別人剛好在這幾秒內送出的訂單，
    // 也避免拿舊資料整包蓋掉其他人同一時間的異動。
    const fresh = await fetchFresh();
    if (!fresh) return;
    const freshForm = fresh.forms.find((f) => f.id === form.id);
    if (!freshForm) return askNotice("找不到這張表單", "這張表單可能已經被刪除了，請返回重新整理。");
    if (freshForm.settled) return askNotice("已經結算過了", "這張表單剛剛已經被結算過，不用重複操作。");
    if (freshForm.orders.length === 0) return askNotice("還沒有人填單", "至少要有一筆訂單才能結算。");
    const freshTotal = freshForm.orders.reduce((s, o) => s + o.total, 0);
    const names = freshForm.orders.map((o) => `${o.userName} ${money(o.total)}`).join("\n");
    const ok = await askConfirm({ title: "確認扣款", body: `以下金額會從各自的儲值金扣除：\n\n${names}\n\n合計 ${money(freshTotal)}\n\n扣款後這張表單就會鎖住。`, confirmLabel: "確認扣款" });
    if (!ok) return;
    // 確認框開著、等管理員點擊的這段時間也可能被別人（或另一個分頁）搶先結算，
    // 真正寫入前再檢查一次最新狀態，避免同一張表單被結算兩次、重複扣款。
    const latest = await fetchFresh();
    if (!latest) return;
    const latestForm = latest.forms.find((f) => f.id === form.id);
    if (!latestForm || latestForm.settled) {
      return askNotice("已經結算過了", "剛剛確認的同時，這張表單已經被結算了，不用重複操作。");
    }
    const stamp = new Date().toISOString();
    const newTxs = latestForm.orders.map((o) => ({
      id: uid(), userId: o.userId, userName: o.userName, date: latestForm.date, ts: stamp,
      amount: -o.total, type: "order", reason: latestForm.title, formId: latestForm.id,
      items: o.lines.map((l) => ({ name: l.name, note: l.note || "", qty: l.qty, price: l.price })),
    }));
    await saveTxs([...newTxs, ...latest.tx]);
    await saveForms(latest.forms.map((f) => (f.id === latestForm.id ? { ...f, settled: true, closed: true, settledAt: stamp } : f)));
  };

  const removeOrder = async (oid) => {
    if (form.settled) return;
    const ok = await askConfirm({ title: "刪除這筆訂單？", body: "這個人就不算在這張表單裡了。", danger: true, confirmLabel: "刪除" });
    if (!ok) return;
    await updateFormFresh(saveForms, form.id, (f) => ({ ...f, orders: f.orders.filter((o) => o.id !== oid) }));
  };

  // 儲存管理員對某筆訂單的修改。寫入前先抓最新資料，訂單已經結算、被取消、或剛被訂餐者改過就擋下來，
  // 避免拿舊的畫面資料蓋掉別人的異動。
  const saveOrderEdit = async (order, lines, orderNote) => {
    const stop = (title, body) => { setEditingOrder(null); return askNotice(title, body); };
    const fresh = await fetchState();
    if (!fresh) return stop("連線失敗", "讀取最新資料失敗，這次的修改沒有儲存，請檢查網路後再試一次。");
    const f = fresh.forms.find((x) => x.id === form.id);
    if (!f) return stop("找不到這張表單", "這張表單可能已經被刪除了，請返回重新整理。");
    if (f.settled) return stop("表單已經結算", "已結算的表單不能再修改訂單。");
    const o = f.orders.find((x) => x.id === order.id);
    if (!o) return stop("找不到這筆訂單", "訂餐者可能剛剛取消了這筆訂單。");
    if (`${o.updatedAt}|${o.adminEditedAt}` !== `${order.updatedAt}|${order.adminEditedAt}`) {
      return stop("訂單剛被更新過", "這筆訂單在你編輯的同時又被異動了，請重新開啟再修改。");
    }
    const newLines = lines.map((l) => ({ name: l.name.trim(), price: Number(l.price) || 0, qty: l.qty, note: l.note.trim() }));
    const updated = {
      ...o, lines: newLines, total: newLines.reduce((s, l) => s + l.qty * l.price, 0),
      note: orderNote, adminEditedAt: new Date().toISOString(),
    };
    await saveForms(fresh.forms.map((x) => (x.id === f.id ? { ...x, orders: x.orders.map((y) => (y.id === o.id ? updated : y)) } : x)));
    setEditingOrder(null);
  };

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900">
        <ChevronLeft size={16} />所有表單
      </button>

      <Panel className="mb-5 p-5">
        <div className="flex flex-wrap items-start gap-4">
          {menuImageSrc(form) && (
            <MenuImage src={menuImageSrc(form)} className="h-20 w-20 shrink-0" label={`${form.title} 菜單照片`} />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight">{form.title}</h2>
            <p className="mt-1 text-sm text-stone-500 tabular-nums">{form.date}　{form.orders.length} 人已填</p>
            {form.link && <div className="mt-2"><FormLink href={form.link} /></div>}
            {!form.settled && (form.closed || form.deadline) && (
              <p className="mt-0.5 text-sm text-stone-500">
                {form.closed
                  ? "已手動停止收單"
                  : isPastDeadline
                    ? `已於 ${fmtDeadline(form.deadline)} 截止`
                    : `截止 ${fmtDeadline(form.deadline)}（剩 ${fmtRemaining(Date.parse(form.deadline) - now)}）`}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums mo-text-strong">{money(total)}</p>
            <p className="text-xs text-stone-500">這張表單總金額</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!form.settled && <Btn variant="quiet" size="sm" onClick={toggleClosed}>{isClosed ? "重新開放填單" : "停止收單"}</Btn>}
          {!form.settled && <Btn variant="quiet" size="sm" onClick={() => setSettingDeadline(true)}><Clock size={14} />{form.deadline ? "修改截止時間" : "設定截止時間"}</Btn>}
          {!form.settled && <Btn variant="quiet" size="sm" onClick={() => setEditingMenu(true)}><Edit3 size={14} />編輯品項與連結</Btn>}
          {form.settled
            ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-1.5 text-sm text-stone-600"><Check size={14} />已於 {form.settledAt?.slice(0, 10)} 完成扣款</span>
            : <Btn size="sm" variant="accent" onClick={settle}><CircleDollarSign size={15} />結算並扣儲值金</Btn>}
        </div>
      </Panel>

      <div className="mb-4 flex gap-1 rounded-lg bg-stone-200 p-1">
        {[{ id: "items", label: "品項統計（給店家）" }, { id: "people", label: "個人金額" }].map((t) => (
          <button key={t.id} onClick={() => setView(t.id)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${view === t.id ? "bg-white text-stone-900" : "text-stone-600"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {view === "items" && stats.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <CopyButton variant="accent" size="sm" label="複製品項統計（打電話用）" text={phoneText}
            filename={`${form.title}-${form.date}.txt`} />
          <CopyButton label="複製成表格" text={statsTsv} filename={`${form.title}-${form.date}-品項統計.csv`} mime="text/csv" />
          <Btn variant="quiet" size="sm" onClick={() => downloadText(`${form.title}-${form.date}-品項統計.csv`, statsCsv, "text/csv")}>
            <Download size={14} />下載 CSV
          </Btn>
        </div>
      )}

      {view === "items" && (
        <Panel>
          {stats.length === 0 ? <Empty icon={Utensils} title="還沒有人填單" hint="把表單分享給大家，這裡會即時彙整。" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-stone-500">
                    <th className="px-4 py-3 font-medium">品項</th>
                    <th className="px-4 py-3 font-medium">備註</th>
                    <th className="px-4 py-3 text-right font-medium">數量</th>
                    <th className="px-4 py-3 text-right font-medium">小計</th>
                    <th className="hidden px-4 py-3 font-medium sm:table-cell">誰點的</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, idx) => (
                    <tr key={idx} className="border-b border-stone-100 last:border-0">
                      <td className="px-4 py-3 font-medium">{s.name}</td>
                      <td className="px-4 py-3">
                        {s.note
                          ? <span className="rounded-md mo-badge px-2 py-0.5 text-xs">{s.note}</span>
                          : <span className="text-stone-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{s.qty}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(s.qty * s.price)}</td>
                      <td className="hidden px-4 py-3 text-xs text-stone-500 sm:table-cell">{s.who.join("、")}</td>
                    </tr>
                  ))}
                  <tr className="bg-stone-50">
                    <td className="px-4 py-3 font-semibold" colSpan={2}>合計</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{stats.reduce((s, i) => s + i.qty, 0)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{money(total)}</td>
                    <td className="hidden sm:table-cell" />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <MenuEditModal open={editingMenu} onClose={() => setEditingMenu(false)} form={form}
        onSave={async (items, link, photo) => {
          setEditingMenu(false); // 先關視窗，之後如果要提示（連線失敗、表單已結算）才不會被擋在視窗後面
          const ok = await updateFormFresh(saveForms, form.id, (f) => {
            const next = { ...f, items, link };
            if (photo.replace) next.menuImage = photo.replace;              // 新照片：伺服器收到後搬到獨立的 key
            else if (photo.remove) { next.menuImage = null; next.hasImage = false; }
            return next;                                                     // 沒動照片就維持原樣
          });
          if (ok && photo.remove) deleteImageOnServer(form.id);
        }} />

      {editingOrder && (
        <AdminOrderEditModal key={editingOrder.id} order={editingOrder} onClose={() => setEditingOrder(null)} onSave={saveOrderEdit} />
      )}

      {settingDeadline && (
        <DeadlineModal form={form} onClose={() => setSettingDeadline(false)} onSave={saveDeadline} />
      )}

      {view === "people" && (
        <Panel>
          {form.orders.length === 0 ? <Empty icon={Users} title="還沒有人填單" /> : (
            <div className="divide-y divide-stone-100">
              {form.orders.map((o) => (
                <div key={o.id} className="flex gap-4 px-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="whitespace-nowrap font-medium">{o.userName}</span>
                      <span className="whitespace-nowrap text-xs text-stone-400 tabular-nums">
                        目前餘額 {money(balances[o.userId] || 0)}
                      </span>
                      {o.adminEditedAt && <span className="whitespace-nowrap rounded mo-badge px-1.5 py-0.5 text-xs">管理員已修改</span>}
                    </div>
                    <ul className="mt-1.5 space-y-0.5 text-sm text-stone-600">
                      {o.lines.map((l, i) => (
                        <li key={i} className="tabular-nums">
                          {l.name} ×{l.qty}
                          {l.note && <span className="ml-1.5 rounded mo-badge px-1.5 py-0.5 text-xs">{l.note}</span>}
                          <span className="ml-2 text-stone-400">{money(l.qty * l.price)}</span>
                        </li>
                      ))}
                    </ul>
                    {o.note && <p className="mt-1.5 text-xs text-stone-500">整單備註：{o.note}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{money(o.total)}</p>
                    {!form.settled && (
                      <div className="mt-1 flex justify-end gap-3">
                        <button onClick={() => setEditingOrder(o)} className="text-xs text-stone-500 hover:text-stone-900">編輯</button>
                        <button onClick={() => removeOrder(o.id)} className="text-xs text-stone-400 hover:text-red-800">刪除</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

/* 設定或修改表單的截止時間（留空儲存 = 不設定） */
function DeadlineModal({ form, onClose, onSave }) {
  const [value, setValue] = useState(() => (form.deadline ? toLocalInput(Date.parse(form.deadline)) : ""));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const d = parseDeadline(value);
    if (d.error) return setErr(d.error);
    setBusy(true);
    await onSave(d.iso);
  };

  return (
    <Modal open onClose={onClose} title="表單截止時間">
      <p className="mb-3 text-sm text-stone-500">時間一到，訂餐者就不能再填或修改這張表單。留空並儲存代表不設定截止時間。</p>
      <DeadlineField value={value} onChange={(v) => { setValue(v); setErr(""); }} />
      {form.closed && (
        <p className="mt-3 rounded-lg mo-badge px-3 py-2 text-sm">這張表單目前是手動停止收單的狀態，設定截止時間不會重新開放；要開放請先按「重新開放填單」。</p>
      )}
      {err && <p className="mt-3 text-sm text-red-800">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="quiet" onClick={onClose}>取消</Btn>
        <Btn disabled={busy} onClick={submit}>{busy ? "儲存中…" : "儲存"}</Btn>
      </div>
    </Modal>
  );
}

/* 管理員修改某位成員已送出的訂單：品項名稱、單價、數量、備註都能改，也能加減品項 */
function AdminOrderEditModal({ order, onClose, onSave }) {
  const [lines, setLines] = useState(() => order.lines.map((l) => ({
    id: uid(), name: l.name, price: String(l.price ?? 0), qty: l.qty, note: l.note || "",
  })));
  const [note, setNote] = useState(order.note || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (id, p) => { setErr(""); setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l))); };
  const drop = (id) => setLines((ls) => ls.filter((l) => l.id !== id));
  const add = () => setLines((ls) => [...ls, { id: uid(), name: "", price: "", qty: 1, note: "" }]);
  const sum = (l) => (Number(l.price) || 0) * l.qty;
  const total = lines.reduce((s, l) => s + sum(l), 0);

  const submit = async () => {
    if (lines.length === 0) return setErr("至少要保留一個品項；要整筆刪除請回到列表按「刪除」。");
    if (lines.some((l) => !l.name.trim())) return setErr("有品項還沒填名稱。");
    setErr(""); setBusy(true);
    await onSave(order, lines, note.trim());
    setBusy(false);
  };

  return (
    <Modal open onClose={onClose} title={`修改 ${order.userName} 的訂單`} wide>
      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {lines.map((l) => (
          <div key={l.id} className="rounded-lg border border-stone-200 p-2.5">
            <div className="flex items-center gap-2">
              <input className={inputCls + " min-w-0 flex-1 font-medium"} value={l.name} placeholder="品項名稱"
                onChange={(e) => patch(l.id, { name: e.target.value })} />
              <button onClick={() => drop(l.id)} title="刪除這一項"
                className="shrink-0 rounded-lg px-2 py-2 text-stone-400 hover:bg-red-50 hover:text-red-800"><Trash2 size={16} /></button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2">
                <span className="shrink-0 whitespace-nowrap text-xs text-stone-500">單價</span>
                <input className={inputCls + " w-24 tabular-nums"} inputMode="decimal" value={l.price} placeholder="0"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => patch(l.id, { price: e.target.value.replace(/[^0-9.]/g, "") })} />
              </label>
              <div className="flex items-center gap-1">
                <span className="mr-1 shrink-0 whitespace-nowrap text-xs text-stone-500">數量</span>
                <button onClick={() => patch(l.id, { qty: Math.max(1, l.qty - 1) })}
                  className="rounded-md border border-stone-300 p-1.5 hover:bg-stone-100"><Minus size={13} /></button>
                <span className="w-7 text-center tabular-nums font-semibold">{l.qty}</span>
                <button onClick={() => patch(l.id, { qty: l.qty + 1 })}
                  className="rounded-md border border-stone-300 p-1.5 hover:bg-stone-100"><Plus size={13} /></button>
              </div>
              <span className="ml-auto text-sm font-semibold tabular-nums">{money(sum(l))}</span>
            </div>
            <input className={inputCls + " mt-2"} value={l.note} placeholder="備註，例如：不要香菜、飯少、加辣"
              onChange={(e) => patch(l.id, { note: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="mt-2"><Btn size="sm" variant="quiet" onClick={add}><Plus size={14} />新增一項</Btn></div>

      <div className="mt-4">
        <Field label="整單備註（可留空）">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2.5 text-sm text-stone-600 tabular-nums">
        原本 {money(order.total)} → 修改後 <span className="font-semibold mo-text-strong">{money(total)}</span>
      </p>
      {err && <p className="mt-3 text-sm text-red-800">{err}</p>}
      <p className="mt-3 text-xs text-stone-500">儲存後這位成員的訂單會標示「管理員已修改」，結算時以修改後的金額扣款。</p>

      <div className="mt-5 flex justify-end gap-2">
        <Btn variant="quiet" onClick={onClose}>取消</Btn>
        <Btn disabled={busy} onClick={submit}>{busy ? "儲存中…" : "儲存修改"}</Btn>
      </div>
    </Modal>
  );
}

function MenuEditModal({ open, onClose, form, onSave }) {
  const [items, setItems] = useState([]);
  const [link, setLink] = useState("");
  const [newPhoto, setNewPhoto] = useState(null);      // 這次剛選的新照片（data URL）
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // 只在視窗打開（或換成另一張表單）時載入內容；不能跟著 form 物件跑，
  // 不然每 12 秒同步一次就會把還沒儲存的修改洗掉
  const formId = form ? form.id : null;
  useEffect(() => {
    if (open && form) {
      setItems(form.items.map((i) => ({ ...i })));
      setLink(form.link || "");
      setNewPhoto(null); setPhotoRemoved(false); setErr("");
    }
  }, [open, formId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form) return null;

  const shownPhoto = photoRemoved ? null : newPhoto || menuImageSrc(form);

  const submit = () => {
    const linkUrl = link.trim() ? safeUrl(link) : null;
    if (link.trim() && !linkUrl) return setErr("外部連結的格式不對，請貼上 http:// 或 https:// 開頭的網址。");
    onSave(
      items.filter((i) => String(i.name).trim()).map((i) => ({ ...i, name: String(i.name).trim(), price: Number(i.price) || 0 })),
      linkUrl,
      { replace: newPhoto || undefined, remove: photoRemoved && !newPhoto },
    );
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("讀取圖片失敗"));
        r.readAsDataURL(file);
      });
      const compressed = await resizeImage(dataUrl);
      setNewPhoto(compressed || dataUrl); setPhotoRemoved(false);
    } catch (e2) {
      setErr("圖片讀取失敗：" + e2.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`編輯「${form.title}」的品項與連結`} wide>
      <p className="mb-4 text-sm text-stone-500">
        改價格或加品項不會動到已經填好的訂單，那些訂單保留當時的價格。要更新舊訂單請該成員重新送出。
      </p>

      <div className="mb-5">
        <span className="mb-1.5 block text-sm font-medium text-stone-700">菜單照片</span>
        <div className="flex items-center gap-3">
          {shownPhoto
            ? <MenuImage src={shownPhoto} className="h-20 w-20" label="菜單照片" />
            : <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-stone-300 text-stone-400"><ImageIcon size={22} /></div>}
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
            <Btn size="sm" variant="quiet" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
              {busy ? <><Loader2 size={14} className="animate-spin" />處理中</> : <><Upload size={14} />{shownPhoto ? "更換照片" : "上傳照片"}</>}
            </Btn>
            {shownPhoto && <button onClick={() => { setNewPhoto(null); setPhotoRemoved(true); }} className="text-left text-xs text-stone-400 hover:text-red-800">移除照片</button>}
          </div>
        </div>
      </div>

      <div className="mb-5">
        <Field label="外部連結（可留空）" hint="例如店家的線上菜單、Google 地圖或訂餐網頁，訂餐者填單時可以直接點開。">
          <input className={inputCls} inputMode="url" value={link} placeholder="https://"
            onChange={(e) => { setLink(e.target.value); setErr(""); }} />
        </Field>
      </div>

      <ItemRows items={items} setItems={setItems} />
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={onClose}>取消</Btn>
        <Btn disabled={busy} onClick={submit}>儲存</Btn>
      </div>
    </Modal>
  );
}

/* ---------------- 結算統計（可選日期範圍） ---------------- */
function DailySettlement({ forms }) {
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());

  // 起訖日期填反了就自動對調
  const valid = !!start && !!end;
  const lo = valid && start > end ? end : start;
  const hi = valid && start > end ? start : end;
  const label = lo === hi ? lo : `${lo} ～ ${hi}`;
  const multiDay = lo !== hi;

  const rangeForms = useMemo(() => (valid ? forms.filter((f) => f.date >= lo && f.date <= hi) : []), [forms, valid, lo, hi]);

  const rows = useMemo(() => {
    const m = new Map();
    rangeForms.forEach((f) => {
      f.orders.forEach((o) => {
        if (!m.has(o.userId)) m.set(o.userId, { userId: o.userId, name: o.userName, total: 0, paid: 0, unpaid: 0, detail: [] });
        const r = m.get(o.userId);
        r.total += o.total;
        if (f.settled) r.paid += o.total; else r.unpaid += o.total;
        r.detail.push({ date: f.date, form: f.title, settled: f.settled, total: o.total, lines: o.lines });
      });
    });
    const list = [...m.values()];
    list.forEach((r) => r.detail.sort((a, b) => a.date.localeCompare(b.date)));
    return list.sort((a, b) => b.total - a.total);
  }, [rangeForms]);

  // 每天的小計（只列有訂單的日子）
  const byDay = useMemo(() => {
    const m = new Map();
    rangeForms.forEach((f) => {
      if (f.orders.length === 0) return;
      if (!m.has(f.date)) m.set(f.date, { date: f.date, forms: 0, people: new Set(), total: 0 });
      const d = m.get(f.date);
      d.forms += 1;
      f.orders.forEach((o) => { d.people.add(o.userId); d.total += o.total; });
    });
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, people: d.people.size }));
  }, [rangeForms]);

  const formCount = rangeForms.filter((f) => f.orders.length > 0).length; // 沒人訂的空表單不算
  const sum = rows.reduce((s, r) => s + r.total, 0);
  const paid = rows.reduce((s, r) => s + r.paid, 0);
  const unpaid = rows.reduce((s, r) => s + r.unpaid, 0);

  const exportRows = [
    ["訂餐日期", "訂餐人", "表單", "品項", "備註", "數量", "單價", "小計", "扣款狀態"],
    ...rows.flatMap((r) => r.detail.flatMap((d) => d.lines.map((l) => [
      d.date, r.name, d.form, l.name, l.note || "", l.qty, l.price, l.qty * l.price, d.settled ? "已扣款" : "未扣款",
    ]))),
    [],
    [`期間 ${label}`],
    ["訂餐人", "期間應付", "已扣款", "未扣款"],
    ...rows.map((r) => [r.name, r.total, r.paid, r.unpaid]),
    ["合計", sum, paid, unpaid],
  ];
  const csv = toCsv(exportRows);
  const tsv = exportRows.map((r) => r.join("\t")).join("\n");
  const fileName = `結算統計-${multiDay ? `${lo}_${hi}` : lo}.csv`;

  // 常用的日期範圍（週一為一週的開始）
  const t = today();
  const monday = addDays(t, -((new Date().getDay() + 6) % 7));
  const monthStart = `${t.slice(0, 8)}01`;
  const prevMonthEnd = addDays(monthStart, -1);
  const presets = [
    ["今天", t, t],
    ["昨天", addDays(t, -1), addDays(t, -1)],
    ["本週", monday, t],
    ["上週", addDays(monday, -7), addDays(monday, -1)],
    ["本月", monthStart, t],
    ["上月", `${prevMonthEnd.slice(0, 8)}01`, prevMonthEnd],
  ];
  const fmtDay = (d) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" });
  };

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">結算統計</h2>
        <p className="mt-1 text-sm text-stone-500">選定一段日期，把期間內所有表單合起來，看每個人要付多少、哪些還沒扣款。</p>
      </div>

      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" aria-label="開始日期" className={inputCls + " w-auto"} value={start} onChange={(e) => setStart(e.target.value)} />
          <span className="text-stone-400">～</span>
          <input type="date" aria-label="結束日期" className={inputCls + " w-auto"} value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {presets.map(([name, a, b]) => {
            const active = lo === a && hi === b;
            return (
              <button key={name} type="button" onClick={() => { setStart(a); setEnd(b); }}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${active ? "mo-chip-solid border-transparent" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"}`}>
                {name}
              </button>
            );
          })}
          {rows.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Btn size="sm" variant="quiet" onClick={() => downloadText(fileName, csv, "text/csv")}>
                <Download size={14} />匯出 CSV
              </Btn>
              <CopyButton label="複製成表格" text={tsv} filename={fileName} mime="text/csv" />
            </div>
          )}
        </div>
      </Panel>

      {!valid ? (
        <Panel><Empty icon={Calendar} title="請選擇開始與結束日期" /></Panel>
      ) : rows.length === 0 ? (
        <Panel><Empty icon={Calendar} title={`${label} 沒有訂餐紀錄`} hint="換一個日期範圍，或先建立表單。" /></Panel>
      ) : (
        <>
          <Panel className="mb-4 p-5">
            <p className="text-sm text-stone-500">{label} 共 {rows.length} 人、{formCount} 張表單</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums mo-text-strong">{money(sum)}</p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
              <span className="text-stone-600">已扣款 <span className="font-semibold">{money(paid)}</span></span>
              <span className={unpaid > 0 ? "mo-text-mid" : "text-stone-600"}>未扣款 <span className="font-semibold">{money(unpaid)}</span></span>
            </div>
            {multiDay && byDay.length > 0 && (
              <div className="mt-4 border-t border-stone-100 pt-3">
                <p className="mb-1.5 text-xs font-medium text-stone-500">每日小計</p>
                <div className="space-y-1">
                  {byDay.map((d) => (
                    <p key={d.date} className="flex justify-between gap-3 text-sm text-stone-600 tabular-nums">
                      <span>{fmtDay(d.date)}　{d.forms} 張表單、{d.people} 人</span>
                      <span>{money(d.total)}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </Panel>
          <Panel>
            <div className="divide-y divide-stone-100">
              {rows.map((r) => (
                <div key={r.userId} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-right">
                      <span className="block text-lg font-semibold tabular-nums">{money(r.total)}</span>
                      {r.unpaid > 0 && r.paid > 0 && <span className="block text-xs tabular-nums mo-text-mid">未扣款 {money(r.unpaid)}</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    {r.detail.map((d, i) => (
                      <p key={i} className="text-sm text-stone-600">
                        {multiDay && <span className="mr-2 tabular-nums text-stone-400">{d.date.slice(5)}</span>}
                        <span className="text-stone-400">{d.form}</span>
                        <span className="ml-2">{d.lines.map((l) => `${l.name}${l.note ? `（${l.note}）` : ""}×${l.qty}`).join("、")}</span>
                        <span className="ml-2 tabular-nums">{money(d.total)}</span>
                        {d.settled
                          ? <span className="ml-2 text-xs mo-text-strong">已扣款</span>
                          : <span className="ml-2 text-xs mo-text-mid">未扣款</span>}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
/* ---------------- 成員與儲值金 ---------------- */
const REASONS = ["儲值", "退款", "轉帳", "現金收款", "更正錯帳", "其他"];

/* 修改成員姓名：伺服器會一併更新過去的訂單與扣款明細上的名字 */
function RenameModal({ user, onClose, onDone }) {
  const [value, setValue] = useState(user.name);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const v = value.trim();
    if (!v) return setErr("姓名不能空白。");
    if (v.length > 30) return setErr("姓名最多 30 個字。");
    if (v === user.name) return onClose();
    setBusy(true); setErr("");
    const r = await adminApi("/rename-member", { method: "POST", body: { userId: user.id, name: v } });
    if (!r.ok) { setBusy(false); return setErr((r.data && r.data.error) || "改名失敗，請稍後再試。"); }
    await onDone();
  };

  return (
    <Modal open onClose={onClose} title={`修改「${user.name}」的姓名`}>
      <Field label="新的姓名" hint="過去的訂單、扣款明細與統計上的名字會一起更新，餘額與紀錄都不受影響。">
        <input className={inputCls} value={value} autoFocus placeholder="例如：王小明"
          onChange={(e) => { setValue(e.target.value); setErr(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </Field>
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={onClose}>取消</Btn>
        <Btn disabled={busy} onClick={submit}>{busy ? "儲存中…" : "儲存"}</Btn>
      </div>
    </Modal>
  );
}

function People({ users, balances, txs, saveUsers, saveTxs, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [initial, setInitial] = useState("");
  const [target, setTarget] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [addErr, setAddErr] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const closeAdd = () => { setAdding(false); setAddErr(""); };

  const addUser = async () => {
    const n = name.trim();
    if (!n || addBusy) return;
    if (n.length > 30) return setAddErr("姓名最多 30 個字。");
    setAddBusy(true); setAddErr("");
    // 用最新的名單來檢查同名，也避免兩位管理員同時新增時其中一位被蓋掉
    const fresh = await fetchState();
    if (!fresh) { setAddBusy(false); return setAddErr("讀取最新資料失敗，這位成員還沒有新增，請檢查網路後再試一次。"); }
    if (fresh.users.some((x) => x.name === n)) {
      setAddBusy(false);
      return setAddErr(`已經有成員叫「${n}」，請加上區分，例如「${n} B」。`);
    }
    const u = { id: uid(), name: n, createdAt: new Date().toISOString() };
    await saveUsers([...fresh.users, u]);
    const amt = Number(initial) || 0;
    if (amt !== 0) {
      await saveTxs([{
        id: uid(), userId: u.id, userName: u.name, date: today(), ts: new Date().toISOString(),
        amount: amt, type: "adjust", reason: "起始儲值金", items: [],
      }, ...fresh.tx]);
    }
    setAddBusy(false); setName(""); setInitial(""); closeAdd();
  };

  const blockedBody = (who, forms) =>
    `${who} 在下面這些還沒結算的表單裡還有訂單：\n\n${forms.map((f) => `・${f.title}（${f.date}）`).join("\n")}\n\n請先把這些表單結算，或到表單裡把他的訂單刪除，再回來刪除成員。`;

  // 隱藏 / 取消隱藏：用最新的名單改，避免蓋掉別人剛新增或改名的成員
  const toggleHidden = async (u) => {
    const fresh = await fetchState();
    if (!fresh) return askNotice("操作失敗", "讀取最新資料失敗，請檢查網路後再試一次。");
    if (!fresh.users.some((x) => x.id === u.id)) return askNotice("找不到這位成員", "他可能已經被刪除，請重新整理。");
    await saveUsers(fresh.users.map((x) => (x.id === u.id ? { ...x, hidden: !u.hidden } : x)));
  };

  const removeUser = async (u) => {
    // 先請伺服器檢查：還有沒結算的訂單就不能刪（刪了之後那張表單結算時，那筆錢不會算進金庫餘額）
    const chk = await adminApi("/remove-member", { method: "POST", body: { userId: u.id, dryRun: true } });
    if (!chk.ok) return askNotice("無法刪除", (chk.data && chk.data.error) || "請稍後再試。");
    if (!chk.data.canDelete) return askNotice(`還不能刪除 ${u.name}`, blockedBody(u.name, chk.data.forms));

    const ok = await askConfirm({
      title: `刪除 ${u.name}？`,
      body: `目前餘額 ${money(chk.data.balance)}，共 ${chk.data.txCount} 筆儲值與扣款紀錄，會一起移除，無法復原。\n\n刪除前請確認已經跟他把現金收付清楚（他的餘額 = 你實際收付的金額），總儲值金餘額才會跟手上的錢對得上。`,
      danger: true, confirmLabel: "刪除成員",
    });
    if (!ok) return;
    const r = await adminApi("/remove-member", { method: "POST", body: { userId: u.id } });
    if (r.status === 409) return askNotice(`還不能刪除 ${u.name}`, blockedBody(u.name, (r.data && r.data.forms) || []));
    if (!r.ok) return askNotice("刪除失敗", (r.data && r.data.error) || "請稍後再試。");
    await onRefresh();
  };

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">成員與儲值金</h2>
          <p className="mt-1 text-sm text-stone-500">每次增減都要寫原因，會留在明細裡。</p>
        </div>
        <Btn onClick={() => setAdding(true)}><Plus size={16} />新增成員</Btn>
      </div>

      <Vault users={users} balances={balances} txs={txs} />

      {users.length === 0 ? (
        <Panel><Empty icon={Users} title="還沒有成員" hint="先把會訂餐的同事建起來，並設定起始儲值金。"
          action={<Btn onClick={() => setAdding(true)}>新增第一位成員</Btn>} /></Panel>
      ) : (
        <Panel>
          <div className="divide-y divide-stone-100">
            {users.map((u) => {
              const b = balances[u.id] || 0;
              return (
                <div key={u.id} className="flex items-center gap-2 px-3 py-4 sm:gap-3 sm:px-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full mo-bg-solid text-sm font-semibold mo-text-ondark-strong">
                    {u.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <span className={u.hidden ? "text-stone-500" : ""}>{u.name}</span>
                      {u.hidden && <span className="ml-2 whitespace-nowrap rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600">已隱藏</span>}
                    </p>
                    <p className={`text-sm tabular-nums ${b < 0 ? "text-red-800" : b < 100 ? "mo-text-mid" : "text-stone-500"}`}>
                      餘額 {money(b)}{b < 0 ? "　已透支" : b < 100 ? "　該儲值了" : ""}
                    </p>
                  </div>
                  <Btn size="sm" variant="quiet" onClick={() => setTarget(u)}>調整儲值金</Btn>
                  <button onClick={() => toggleHidden(u)} title={u.hidden ? "取消隱藏（讓他出現在「我要訂餐」名單）" : "隱藏（不出現在「我要訂餐」名單）"}
                    aria-label={u.hidden ? `取消隱藏 ${u.name}` : `隱藏 ${u.name}`}
                    className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 sm:p-2">{u.hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  <button onClick={() => setRenaming(u)} title="修改姓名" aria-label={`修改 ${u.name} 的姓名`}
                    className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 sm:p-2"><Edit3 size={16} /></button>
                  <button onClick={() => removeUser(u)} className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-800 sm:p-2"><Trash2 size={16} /></button>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Modal open={adding} onClose={closeAdd} title="新增成員">
        <div className="space-y-4">
          <Field label="姓名">
            <input className={inputCls} value={name} autoFocus placeholder="例如：王小明"
              onChange={(e) => { setName(e.target.value); setAddErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") addUser(); }} />
          </Field>
          <Field label="起始儲值金" hint="之後每天訂餐會從這裡扣。可以先填 0。">
            <input className={inputCls + " tabular-nums"} type="number" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="0" />
          </Field>
        </div>
        {addErr && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{addErr}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Btn variant="quiet" onClick={closeAdd}>取消</Btn>
          <Btn disabled={addBusy} onClick={addUser}>{addBusy ? "新增中…" : "新增"}</Btn>
        </div>
      </Modal>

      {renaming && (
        <RenameModal key={renaming.id} user={renaming} onClose={() => setRenaming(null)}
          onDone={async () => { setRenaming(null); await onRefresh(); }} />
      )}

      <AdjustModal user={target} onClose={() => setTarget(null)} balance={target ? balances[target.id] || 0 : 0}
        onSubmit={async (amount, reason, note) => {
          await saveTxs([{
            id: uid(), userId: target.id, userName: target.name, date: today(), ts: new Date().toISOString(),
            amount, type: "adjust", reason, note, items: [],
          }, ...txs]);
          setTarget(null);
        }} />
    </div>
  );
}

/* 總儲值金：網頁上所有人餘額的加總，用來跟手上的現金核對 */
function Vault({ users, balances, txs }) {
  const totalBalance = users.reduce((s, u) => s + (balances[u.id] || 0), 0);
  const topUp = txs.filter((t) => t.type === "adjust" && t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const refund = txs.filter((t) => t.type === "adjust" && t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const spent = txs.filter((t) => t.type === "order").reduce((s, t) => s + t.amount, 0);
  const negatives = users.filter((u) => (balances[u.id] || 0) < 0);

  return (
    <Panel className="mb-5 p-5">
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="text-sm text-stone-500">總儲值金餘額（{users.length} 人加總）</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums mo-text-strong">{money(totalBalance)}</p>
          <p className="mt-1 text-xs text-stone-500">手上現金應該等於這個數字</p>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><p className="text-stone-500">累計收款</p><p className="tabular-nums font-medium mo-text-strong">{money(topUp)}</p></div>
          <div><p className="text-stone-500">累計退款</p><p className="tabular-nums font-medium">{money(refund)}</p></div>
          <div><p className="text-stone-500">累計訂餐扣款</p><p className="tabular-nums font-medium">{money(spent)}</p></div>
        </div>
      </div>
      {negatives.length > 0 && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          有 {negatives.length} 人已透支（訂餐花的比儲值的多）：{negatives.map((u) => u.name).join("、")}。他們的負數餘額已經扣在上面的總額裡，核對現金時直接拿總額比對就好，不用再另外加減；他們補儲值之後，總額和手上的現金會一起增加。
        </p>
      )}
    </Panel>
  );
}

function AdjustModal({ user, onClose, onSubmit, balance }) {
  const [dir, setDir] = useState("in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("儲值");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { if (user) { setDir("in"); setAmount(""); setReason("儲值"); setNote(""); setErr(""); } }, [user]);
  if (!user) return null;

  const submit = () => {
    const n = Number(amount);
    if (!n || n <= 0) return setErr("填一個大於 0 的金額。");
    if (!reason) return setErr("選一個原因。");
    onSubmit(dir === "in" ? n : -n, reason, note.trim());
  };

  const preview = balance + (Number(amount) || 0) * (dir === "in" ? 1 : -1);

  return (
    <Modal open={!!user} onClose={onClose} title={`調整 ${user.name} 的儲值金`}>
      <p className="mb-4 text-sm text-stone-500 tabular-nums">目前餘額 <span className="font-semibold text-stone-900">{money(balance)}</span></p>
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-stone-200 p-1">
          <button onClick={() => { setDir("in"); setReason("儲值"); }}
            className={`flex-1 rounded-md py-2 text-sm font-medium ${dir === "in" ? "bg-white mo-text-strong" : "text-stone-600"}`}>增加</button>
          <button onClick={() => { setDir("out"); setReason("退款"); }}
            className={`flex-1 rounded-md py-2 text-sm font-medium ${dir === "out" ? "bg-white text-red-800" : "text-stone-600"}`}>減少</button>
        </div>
        <Field label="金額">
          <input className={inputCls + " tabular-nums"} type="number" autoFocus value={amount}
            onChange={(e) => { setAmount(e.target.value); setErr(""); }} placeholder="0" />
        </Field>
        <Field label="原因" hint="會顯示在這個人的扣款明細裡。">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="補充說明（可留空）">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：轉帳末五碼 12345" />
        </Field>
        {amount !== "" && (
          <p className="rounded-lg bg-stone-50 px-3 py-2.5 text-sm text-stone-600 tabular-nums">
            調整後餘額 <span className={`font-semibold ${preview < 0 ? "text-red-800" : "mo-text-strong"}`}>{money(preview)}</span>
          </p>
        )}
        {err && <p className="text-sm text-red-800">{err}</p>}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={onClose}>取消</Btn>
        <Btn onClick={submit}>{dir === "in" ? "增加儲值金" : "扣除儲值金"}</Btn>
      </div>
    </Modal>
  );
}

/* ---------------- 管理員：扣款明細 ---------------- */
const AUDIT_FIELD = { amount: "金額", date: "日期", reason: "原因", note: "補充說明" };
function describeAudit(a) {
  if (a.action === "delete") return [`刪除：${a.before.date}　${a.before.reason}　${money(a.before.amount)}${a.before.note ? `　（${a.before.note}）` : ""}`];
  return (a.changed || []).map((f) => (f === "amount"
    ? `${AUDIT_FIELD[f]} ${money(a.before[f])} → ${money(a.after[f])}`
    : `${AUDIT_FIELD[f]}「${a.before[f] || "（空）"}」→「${a.after[f] || "（空）"}」`));
}

function AdminLedger({ txs, users, onRefresh }) {
  const [who, setWho] = useState("all");
  const [kind, setKind] = useState("all");
  const [editing, setEditing] = useState(null);
  const [audit, setAudit] = useState(null);
  const [showAllAudit, setShowAllAudit] = useState(false);

  const loadAudit = useCallback(async () => {
    const r = await adminApi("/ledger-correct?audit=1");
    if (r.ok) setAudit(r.data.items || []);
  }, []);
  useEffect(() => { loadAudit(); }, [loadAudit]);

  const balanceOf = (userId) => txs.filter((t) => t.userId === userId).reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const rows = txs
    .filter((t) => (who === "all" ? true : t.userId === who))
    .filter((t) => (kind === "all" ? true : kind === "order" ? t.type === "order" : t.type !== "order"))
    .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

  const removeTx = async (t) => {
    const b = balanceOf(t.userId);
    const ok = await askConfirm({
      title: "刪除這筆明細？",
      body: `${t.userName}　${t.date}　${t.type === "order" ? "訂餐扣款" : t.reason}　${money(t.amount)}\n\n刪除後 ${t.userName} 的餘額會從 ${money(b)} 變成 ${money(b - t.amount)}。\n這個動作會記在「更正紀錄」裡，但這筆明細本身無法復原。`,
      danger: true, confirmLabel: "刪除這筆",
    });
    if (!ok) return;
    const r = await adminApi("/ledger-correct", { method: "POST", body: { action: "delete", txId: t.id } });
    if (!r.ok) return askNotice("刪除失敗", (r.data && r.data.error) || "請稍後再試。");
    await onRefresh();
    loadAudit();
  };

  const shownAudit = audit ? (showAllAudit ? audit : audit.slice(0, 10)) : [];

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">扣款明細</h2>
        <p className="mt-1 text-sm text-stone-500">所有人的每一筆進出，含日期、品項與金額。記錯的可以更正或刪除，每次更正都會留下紀錄。</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <select className={inputCls + " w-auto"} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="all">全部成員</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className={inputCls + " w-auto"} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">全部類型</option>
          <option value="order">訂餐扣款</option>
          <option value="adjust">儲值與調整</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <Panel><Empty icon={Receipt} title="沒有符合的紀錄" hint="結算表單或調整儲值金之後，紀錄會出現在這裡。" /></Panel>
      ) : (
        <Panel><LedgerTable rows={rows} showName onEdit={setEditing} onDelete={removeTx} /></Panel>
      )}

      <Panel className="mt-6 p-5">
        <p className="text-sm font-medium text-stone-800">更正紀錄{audit ? `（${audit.length}）` : ""}</p>
        <p className="mt-1 text-sm text-stone-500">每次更正或刪除明細都會記在這裡，保留最近 500 筆。</p>
        {audit && audit.length === 0 && <p className="mt-3 text-sm text-stone-500">還沒有任何更正。</p>}
        {shownAudit.length > 0 && (
          <div className="mt-3 divide-y divide-stone-100">
            {shownAudit.map((a) => (
              <div key={a.id} className="py-3">
                <p className="text-sm">
                  <span className="font-medium">{a.userName}</span>
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${a.action === "delete" ? "bg-red-50 text-red-800" : "mo-badge"}`}>{a.action === "delete" ? "刪除" : "更正"}</span>
                  <span className="ml-2 text-xs text-stone-400 tabular-nums">{fmtDateTime(a.at)}</span>
                </p>
                {describeAudit(a).map((line, i) => <p key={i} className="mt-0.5 text-sm text-stone-600 tabular-nums">{line}</p>)}
              </div>
            ))}
          </div>
        )}
        {audit && audit.length > 10 && (
          <button type="button" onClick={() => setShowAllAudit((v) => !v)} className="mt-3 text-sm text-stone-500 hover:text-stone-800">
            {showAllAudit ? "只看最近 10 筆" : `顯示全部 ${audit.length} 筆`}
          </button>
        )}
      </Panel>

      {editing && (
        <LedgerEditModal key={editing.id} tx={editing} balance={balanceOf(editing.userId)} onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await onRefresh(); loadAudit(); }} />
      )}
    </div>
  );
}

/* 更正一筆明細：金額、日期、原因、補充說明（類型不能改） */
function LedgerEditModal({ tx, balance, onClose, onDone }) {
  const [amount, setAmount] = useState(String(tx.amount));
  const [date, setDate] = useState(tx.date || "");
  const [reason, setReason] = useState(tx.reason || "");
  const [note, setNote] = useState(tx.note || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const n = Number(amount);
  const amountOk = amount.trim() !== "" && Number.isFinite(n) && n !== 0;
  const after = amountOk ? balance - tx.amount + n : balance;

  const submit = async () => {
    if (busy) return;
    if (!amountOk) return setErr("金額要是一個不是 0 的數字。");
    if (!date) return setErr("請選擇日期。");
    if (!reason.trim()) return setErr("原因不能空白。");
    const patch = {};
    if (n !== tx.amount) patch.amount = n;
    if (date !== tx.date) patch.date = date;
    if (reason.trim() !== (tx.reason || "")) patch.reason = reason.trim();
    if (note.trim() !== (tx.note || "")) patch.note = note.trim();
    if (Object.keys(patch).length === 0) return onClose();
    setBusy(true); setErr("");
    const r = await adminApi("/ledger-correct", { method: "POST", body: { action: "edit", txId: tx.id, patch } });
    if (!r.ok) { setBusy(false); return setErr((r.data && r.data.error) || "更正失敗，請稍後再試。"); }
    await onDone();
  };

  return (
    <Modal open onClose={onClose} title="更正這筆明細">
      <p className="mb-4 text-sm text-stone-500">{tx.userName}　{tx.type === "order" ? "訂餐扣款" : "儲值與調整"}</p>
      <div className="space-y-4">
        <Field label="金額" hint={tx.type === "order" ? "訂餐扣款要填負數，例如 -120。" : "增加餘額填正數，減少餘額填負數，例如 -100。"}>
          <input className={inputCls + " tabular-nums"} value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.-]/g, "")); setErr(""); }} />
        </Field>
        <Field label="日期"><input type="date" className={inputCls} value={date} onChange={(e) => { setDate(e.target.value); setErr(""); }} /></Field>
        <Field label={tx.type === "order" ? "原因（表單名稱）" : "原因"}>
          <input className={inputCls} list="ledger-reasons" value={reason} onChange={(e) => { setReason(e.target.value); setErr(""); }} />
          <datalist id="ledger-reasons">{REASONS.map((r) => <option key={r} value={r} />)}</datalist>
        </Field>
        <Field label="補充說明（可留空）">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：原本多打一個 0" />
        </Field>
      </div>
      <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2.5 text-sm text-stone-600 tabular-nums">
        {tx.userName} 的餘額：{money(balance)} → <span className={`font-semibold ${after < 0 ? "text-red-800" : "mo-text-strong"}`}>{money(after)}</span>
      </p>
      {tx.type === "order" && <p className="mt-2 text-xs text-stone-500">這只會改這筆扣款的金額，不會改表單裡的訂單內容與金額。</p>}
      <p className="mt-2 text-xs text-stone-500">更正後這筆明細會標示「已更正」，更正前的內容會留在「更正紀錄」。</p>
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={onClose}>取消</Btn>
        <Btn disabled={busy} onClick={submit}>{busy ? "儲存中…" : "儲存更正"}</Btn>
      </div>
    </Modal>
  );
}

function LedgerTable({ rows, showName, onEdit, onDelete }) {
  const editable = !!(onEdit || onDelete);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-stone-500">
            <th className="px-2 py-3 font-medium sm:px-4">日期</th>
            {showName && <th className="px-2 py-3 font-medium sm:px-4">成員</th>}
            <th className="px-2 py-3 font-medium sm:px-4">品項／原因</th>
            <th className="px-2 py-3 text-right font-medium sm:px-4">金額</th>
            {editable && <th className="px-2 py-3"><span className="sr-only">操作</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-stone-100 last:border-0 align-top">
              <td className="whitespace-nowrap px-2 py-3 tabular-nums text-stone-600 sm:px-4"><span className="sm:hidden">{String(t.date || "").slice(5)}</span><span className="hidden sm:inline">{t.date}</span></td>
              {showName && <td className="whitespace-nowrap px-2 py-3 font-medium sm:px-4">{t.userName}</td>}
              <td className="px-2 py-3 sm:px-4">
                {t.type === "order" ? (
                  <>
                    <span className="text-xs text-stone-400">{t.reason}</span>
                    {t.correctedAt && <span className="ml-2 whitespace-nowrap rounded mo-badge px-1.5 py-0.5 text-xs">已更正</span>}
                    <ul className="mt-0.5 space-y-0.5">
                      {(t.items || []).map((l, i) => (
                        <li key={i}>
                          {l.name} ×{l.qty}
                          {l.note && <span className="ml-1.5 rounded mo-badge px-1.5 py-0.5 text-xs">{l.note}</span>}
                        </li>
                      ))}
                    </ul>
                    {t.note && <p className="mt-0.5 text-xs text-stone-500">{t.note}</p>}
                  </>
                ) : (
                  <>
                    <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-700">{t.reason}</span>
                    {t.correctedAt && <span className="ml-2 whitespace-nowrap rounded mo-badge px-1.5 py-0.5 text-xs">已更正</span>}
                    {t.note && <span className="ml-2 text-xs text-stone-500">{t.note}</span>}
                  </>
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-3 text-right sm:px-4"><Money v={t.amount} strong /></td>
              {editable && (
                <td className="sticky right-0 whitespace-nowrap bg-white px-1 py-2 text-right">
                  {onEdit && <button type="button" onClick={() => onEdit(t)} title="更正" aria-label="更正這筆明細"
                    className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><Edit3 size={15} /></button>}
                  {onDelete && <button type="button" onClick={() => onDelete(t)} title="刪除" aria-label="刪除這筆明細"
                    className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-800"><Trash2 size={15} /></button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
/* ---------------- 設定 ---------------- */
function SettingsPane({ cfg, saveCfg, onWipe }) {
  const [title, setTitle] = useState(cfg.title || "今天吃什麼");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const newPin = pin.trim();
    if (newPin && newPin.length < 4) return setErr("密碼至少 4 個字元");
    setErr("");
    const payload = { title: title.trim() || "今天吃什麼" };
    if (newPin) payload.pin = newPin;
    await saveCfg(payload);
    setPin("");
    setSaved(true);
  };

  return (
    <div className="max-w-2xl">
      <h2 className="mb-5 text-xl font-semibold tracking-tight">設定</h2>
      <Panel className="max-w-lg space-y-4 p-5">
        <Field label="網站名稱"><input className={inputCls} value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} /></Field>
        <Field label="管理員密碼" hint="訂餐者不需要密碼，只有管理端要。基於安全考量不會顯示目前的密碼；留空表示不更改，輸入新密碼（至少 4 個字元）才會更換。">
          <input className={inputCls} type="password" autoComplete="new-password" value={pin} placeholder="輸入新密碼才會更換"
            onChange={(e) => { setPin(e.target.value); setErr(""); setSaved(false); }} />
        </Field>
        {err && <p className="text-sm text-red-800">{err}</p>}
        <div className="flex items-center gap-3">
          <Btn onClick={save}>儲存設定</Btn>
          {saved && <span className="flex items-center gap-1 text-sm mo-text-strong"><Check size={15} />已儲存</span>}
        </div>
      </Panel>

      <BackupPane />

      <Panel className="mt-5 max-w-lg p-5">
        <p className="text-sm font-medium text-stone-800">清除全部資料</p>
        <p className="mt-1 text-sm text-stone-500">刪除所有成員、表單與帳務紀錄。清除前會先自動備份一份成員與交易紀錄，之後可以從上面的備份還原。</p>
        <div className="mt-3">
          <Btn variant="danger" size="sm" onClick={async () => {
            const ok = await askConfirm({ title: "清除全部資料？", body: "所有成員、表單與帳務紀錄都會刪除。成員與交易紀錄會先自動備份一份，但表單與訂單無法復原。", danger: true, confirmLabel: "全部清除" });
            if (!ok) return;
            const b = await adminApi("/backup", { method: "POST", body: { action: "create" } });
            if (!b.ok) return askNotice("沒有清除", "清除前的自動備份失敗，為了安全這次不清除，請稍後再試。");
            onWipe();
          }}>清除全部資料</Btn>
        </div>
      </Panel>
    </div>
  );
}

/* 資料備份：每日自動備份的狀態與清單、立即備份、下載備份檔、還原 */
function BackupPane() {
  const [info, setInfo] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState("");
  const [lastDownload, setLastDownload] = useState(() => { try { return Number(localStorage.getItem(LAST_DOWNLOAD_KEY)) || 0; } catch (e) { return 0; } });
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    const r = await adminApi("/backup?list=1");
    if (r.ok) { setInfo(r.data); setLoadErr(""); } else setLoadErr((r.data && r.data.error) || "讀取備份清單失敗");
  }, []);
  useEffect(() => { load(); }, [load]);

  const markDownloaded = () => {
    const t = Date.now();
    try { localStorage.setItem(LAST_DOWNLOAD_KEY, String(t)); } catch (e) { /* 存不了就算了，只是少了提醒 */ }
    setLastDownload(t);
  };

  // 目前資料的備份檔 / 餘額表
  const downloadCurrent = async (kind) => {
    setBusy(kind);
    const r = await adminApi("/backup?current=1");
    setBusy("");
    if (!r.ok) return askNotice("下載失敗", (r.data && r.data.error) || "請稍後再試。");
    const snap = r.data;
    if (kind === "json") {
      downloadJson(`餐費備份-${fileStamp()}.json`, snap);
      markDownloaded();
    } else {
      const rows = [
        ["備份時間", fmtDateTime(snap.createdAt)],
        ["金庫總餘額", snap.summary.vault],
        [],
        ["成員", "餘額"],
        ...snap.balances.map((b) => [b.name, b.balance]),
      ];
      downloadText(`餘額表-${fileStamp()}.csv`, toCsv(rows), "text/csv");
    }
  };

  const downloadSnapshot = async (it) => {
    setBusy(it.id);
    const r = await adminApi(`/backup?id=${encodeURIComponent(it.id)}`);
    setBusy("");
    if (!r.ok) return askNotice("下載失敗", (r.data && r.data.error) || "找不到這份備份。");
    downloadJson(`餐費備份-${fileStamp(new Date(it.createdAt))}-${BACKUP_KIND[it.kind]}.json`, r.data);
    markDownloaded();
  };

  const createNow = async () => {
    setBusy("create");
    const r = await adminApi("/backup", { method: "POST", body: { action: "create" } });
    setBusy("");
    if (!r.ok) return askNotice("備份失敗", (r.data && r.data.error) || "請稍後再試。");
    await load();
    await askNotice("已備份", `已備份目前的資料：金庫總餘額 ${money(r.data.entry.vault)}、${r.data.entry.members} 位成員。`);
  };

  const confirmRestore = async (label, s, payload) => {
    const ok = await askConfirm({
      title: "還原成這個備份？",
      body: `${label}\n金庫總餘額 ${money(s.vault)}、${s.members} 位成員、${s.txCount} 筆交易紀錄\n\n會用這份備份覆蓋「目前的成員名單與全部交易紀錄」，表單與訂單不受影響。\n還原前會先自動把現在的資料另存一份，按錯了還能還原回來。`,
      danger: true, confirmLabel: "確認還原",
    });
    if (!ok) return;
    setBusy("restore");
    const r = await adminApi("/backup", { method: "POST", body: { action: "restore", ...payload } });
    setBusy("");
    if (!r.ok) return askNotice("還原失敗", (r.data && r.data.error) || "請稍後再試。");
    await askNotice("已還原", `金庫總餘額 ${money(r.data.vault)}（${r.data.members} 位成員）。畫面會重新載入。`);
    window.location.reload();
  };

  const onPickFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const snap = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      if (!snap || snap.app !== "meal-order-app" || !snap.summary) throw new Error("not a backup");
      await confirmRestore(`備份檔「${file.name}」（${fmtDateTime(snap.createdAt)}）`, snap.summary, { snapshot: snap });
    } catch (err) {
      await askNotice("讀不了這個檔案", "請選擇從這個網站下載的備份檔（.json）。");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const days = lastDownload ? Math.floor((Date.now() - lastDownload) / 86400000) : null;
  const lastRun = info && info.lastRun;

  return (
    <Panel className="mt-5 p-5">
      <p className="text-sm font-medium text-stone-800">資料備份</p>
      <p className="mt-1 text-sm text-stone-500">
        每天凌晨 4 點（台灣時間）自動備份成員名單、全部交易紀錄與每人餘額，保留最近 30 份；資料沒變動的日子不會產生新備份。
      </p>
      <p className="mt-2 text-sm text-stone-600">
        上次自動備份：{lastRun
          ? `${fmtDateTime(lastRun.at)}（${lastRun.result === "saved" ? "已備份" : "沒有變動，不需備份"}）`
          : "還沒有執行過，第一次會在今天凌晨自動執行"}
      </p>
      {loadErr && <p className="mt-2 text-sm text-red-800">{loadErr}</p>}

      <div className={`mt-4 rounded-lg px-3 py-2.5 text-sm ${days === null || days >= 7 ? "mo-badge" : "bg-stone-50 text-stone-600"}`}>
        <p className="font-medium">自動備份存在同一個資料庫裡，資料庫本身出問題時會一起消失，所以也請定期下載備份檔，存到自己的雲端硬碟或電腦。</p>
        <p className="mt-1">
          {days === null ? "這個瀏覽器還沒有下載過備份檔，建議現在下載一份。"
            : days >= 7 ? `上次在這個瀏覽器下載備份檔是 ${days} 天前，建議再下載一份。`
              : `上次在這個瀏覽器下載備份檔：${days === 0 ? "今天" : `${days} 天前`}。`}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Btn size="sm" variant="accent" disabled={!!busy} onClick={() => downloadCurrent("json")}>
          {busy === "json" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}下載完整備份檔
        </Btn>
        <Btn size="sm" variant="quiet" disabled={!!busy} onClick={() => downloadCurrent("csv")}>
          {busy === "csv" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}下載餘額表（Excel）
        </Btn>
        <Btn size="sm" variant="quiet" disabled={!!busy} onClick={createNow}>
          {busy === "create" ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}立即備份一份
        </Btn>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onPickFile} />
        <Btn size="sm" variant="danger" disabled={!!busy} onClick={() => fileRef.current && fileRef.current.click()}>
          <Upload size={14} />從備份檔還原…
        </Btn>
      </div>

      <h3 className="mb-1 mt-6 text-sm font-medium text-stone-700">備份清單{info ? `（${info.items.length}）` : ""}</h3>
      {!info && !loadErr && <p className="py-4 text-sm text-stone-500">讀取中…</p>}
      {info && info.items.length === 0 && <p className="py-4 text-sm text-stone-500">還沒有備份。可以先按「立即備份一份」。</p>}
      {info && info.items.length > 0 && (
        <div className="divide-y divide-stone-100">
          {info.items.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-800">
                  {fmtDateTime(it.createdAt)}
                  <span className="ml-2 whitespace-nowrap rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600">{BACKUP_KIND[it.kind] || it.kind}</span>
                </p>
                <p className="mt-0.5 text-xs text-stone-500 tabular-nums">金庫 {money(it.vault)}　{it.members} 位成員　{it.txCount} 筆交易</p>
              </div>
              <div className="flex gap-2">
                <Btn size="sm" variant="quiet" disabled={!!busy} onClick={() => downloadSnapshot(it)}>下載</Btn>
                <Btn size="sm" variant="danger" disabled={!!busy}
                  onClick={() => confirmRestore(`${fmtDateTime(it.createdAt)} 的${BACKUP_KIND[it.kind] || ""}備份`, it, { id: it.id })}>還原</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------------- 訂餐者：表單列表 ---------------- */
function UserForms({ forms, me, onOpen }) {
  const now = useNow();
  const open = forms.filter((f) => !f.settled).sort((a, b) => b.date.localeCompare(a.date));
  const done = forms.filter((f) => f.settled).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  const mine = (f) => f.orders.find((o) => o.userId === me.id);

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold tracking-tight">我要訂餐</h2>
      <p className="mb-5 text-sm text-stone-500">點一張表單就能填，送出後還可以改，直到管理員結算。</p>

      {open.length === 0 ? (
        <Panel><Empty icon={Utensils} title="現在沒有開放中的表單" hint="管理員開單之後，這裡就會出現。" /></Panel>
      ) : (
        <div className="space-y-3">
          {open.map((f) => {
            const o = mine(f);
            return (
              <button key={f.id} onClick={() => onOpen(f.id)}
                className="block w-full rounded-xl border border-stone-200 bg-white p-4 text-left mo-hover-border">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-base font-semibold">{f.title}</span>
                  {formClosed(f, now)
                    ? <span className="rounded-md bg-stone-200 px-2 py-0.5 text-xs text-stone-600">已截止</span>
                    : o
                      ? <span className="rounded-md bg-stone-200 px-2 py-0.5 text-xs text-stone-700">已填 {money(o.total)}</span>
                      : <span className="rounded-md mo-btn-accent px-2 py-0.5 text-xs font-medium">還沒填</span>}
                </div>
                <p className="mt-1 text-sm text-stone-500 tabular-nums">{f.date}　{f.items.length} 個品項</p>
                {f.deadline && (
                  <p className="mt-0.5 text-xs text-stone-400">
                    {formClosed(f, now) ? `截止時間 ${fmtDeadline(f.deadline)}` : `${fmtDeadline(f.deadline)} 截止（剩 ${fmtRemaining(Date.parse(f.deadline) - now)}）`}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <>
          <h3 className="mb-2 mt-8 text-sm font-medium text-stone-500">已結算</h3>
          <div className="space-y-2">
            {done.map((f) => {
              const o = mine(f);
              return (
                <div key={f.id} className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm">
                  <span className="flex-1 truncate">{f.title}</span>
                  <span className="text-stone-400 tabular-nums">{f.date}</span>
                  <span className="tabular-nums text-stone-600">{o ? money(o.total) : "未參加"}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- 訂餐者：填單 ---------------- */
function OrderEditor({ form, me, forms, saveForms, onBack, balance }) {
  const existing = form ? form.orders.find((o) => o.userId === me.id) : null;
  const [lines, setLines] = useState(existing ? existing.lines.map((l) => ({ ...l, id: uid() })) : []);
  const [note, setNote] = useState(existing ? existing.note || "" : "");
  const [custom, setCustom] = useState({ name: "", price: "" });
  const [saved, setSaved] = useState(false);
  // 畫面上的餐點是進來時的版本；記下當時管理員修改的時間，送出時發現又被改過就擋下來，免得蓋掉管理員的修改
  const loadedAdminEdit = useRef(existing ? existing.adminEditedAt || "" : "");
  const now = useNow();

  if (!form) return <Empty icon={FileText} title="找不到這張表單" action={<Btn onClick={onBack}>返回</Btn>} />;

  const pastDeadline = deadlinePassed(form, now);
  const locked = form.closed || form.settled || pastDeadline;
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  const addLine = (item) => {
    setSaved(false);
    setLines((ls) => {
      const hit = ls.find((l) => l.name === item.name && !(l.note || "").trim());
      if (hit) return ls.map((l) => (l.id === hit.id ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { id: uid(), name: item.name, price: Number(item.price) || 0, qty: 1, note: "" }];
    });
  };
  const patch = (id, p) => { setSaved(false); setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l))); };
  const drop = (id) => { setSaved(false); setLines((ls) => ls.filter((l) => l.id !== id)); };

  const submit = async () => {
    if (lines.length === 0) return askNotice("還沒選餐點", "從上面的菜單點一下就會加進來。");
    // 送出前先重新抓一次最新資料：如果表單這幾秒內被管理員截止或結算了，就擋下來，
    // 不要拿畫面上舊的表單狀態整包蓋回去（會把管理員剛做的截止/結算蓋掉）。
    const fresh = await fetchFresh();
    if (!fresh) return;
    const freshForm = fresh.forms.find((f) => f.id === form.id);
    if (!freshForm) return askNotice("找不到這張表單", "這張表單可能已經被刪除了，請返回重新整理。");
    // fetchState 剛更新過伺服器時間的差值，這裡用的 serverNow() 就是最新的
    if (freshForm.closed || freshForm.settled || deadlinePassed(freshForm, serverNow())) {
      return askNotice(
        freshForm.settled ? "表單已經結算" : !freshForm.closed ? "已經超過截止時間" : "已經截止收單了",
        freshForm.settled ? "管理員剛好已經完成結算，這筆訂單沒有送出，請直接找管理員處理。" : "要補點請找管理員，這筆訂單沒有送出。"
      );
    }
    const freshMine = freshForm.orders.find((o) => o.userId === me.id);
    if (freshMine && (freshMine.adminEditedAt || "") !== loadedAdminEdit.current) {
      return askNotice("管理員剛修改過你的訂單", "這次沒有送出，避免蓋掉管理員的修改。請按「所有表單」返回，再重新進來確認內容。");
    }
    const order = {
      id: existing ? existing.id : uid(),
      userId: me.id, userName: me.name,
      lines: lines.map((l) => ({ name: l.name, price: Number(l.price) || 0, qty: l.qty, note: (l.note || "").trim() })),
      total, note: note.trim(), updatedAt: new Date().toISOString(),
    };
    const next = fresh.forms.map((f) => {
      if (f.id !== form.id) return f;
      const others = f.orders.filter((o) => o.userId !== me.id);
      return { ...f, orders: [...others, order] };
    });
    await saveForms(next);
    loadedAdminEdit.current = "";
    setSaved(true);
  };

  const withdraw = async () => {
    const ok = await askConfirm({ title: "取消這次訂餐？", body: "你填的內容會從這張表單移除。", danger: true, confirmLabel: "取消訂餐" });
    if (!ok) return;
    const fresh = await fetchFresh();
    if (!fresh) return;
    const f = fresh.forms.find((x) => x.id === form.id);
    if (!f) return askNotice("找不到這張表單", "這張表單可能已經被刪除了，請返回重新整理。");
    if (f.closed || f.settled || deadlinePassed(f, serverNow())) {
      return askNotice(f.settled ? "表單已經結算" : "已經截止收單了", "現在不能再取消訂單，要更動請找管理員。");
    }
    await saveForms(fresh.forms.map((x) => (x.id === form.id ? { ...x, orders: x.orders.filter((o) => o.userId !== me.id) } : x)));
    onBack();
  };

  const menu = form.items;

  return (
    <div className="pb-24">
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900">
        <ChevronLeft size={16} />所有表單
      </button>

      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">{form.title}</h2>
        <p className="mt-1 text-sm text-stone-500 tabular-nums">{form.date}　你的餘額 {money(balance)}</p>
        {locked && (
          <p className="mt-3 rounded-lg mo-badge px-3 py-2.5 text-sm">
            {form.settled
              ? "這張表單已結算，無法再更改。"
              : pastDeadline && !form.closed
                ? `已經超過截止時間（${fmtDeadline(form.deadline)}），要補點請找管理員。`
                : "已經截止收單了，要補點請找管理員。"}
          </p>
        )}
        {!locked && form.deadline && (
          <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2.5 text-sm text-stone-700 tabular-nums">
            {fmtDeadline(form.deadline)} 截止，還剩 <span className="font-semibold">{fmtRemaining(Date.parse(form.deadline) - now)}</span>
          </p>
        )}
        {loadedAdminEdit.current && (
          <p className="mt-3 rounded-lg mo-badge px-3 py-2.5 text-sm">管理員調整過你的訂單內容，下方是調整後的版本。</p>
        )}
      </div>

      {form.link && <div className="mb-5"><FormLink href={form.link} /></div>}

      <MenuImageBanner src={menuImageSrc(form)} />

      {!locked && (
        <Panel className="mb-5">
          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
            {menu.map((i) => (
              <button key={i.id} onClick={() => addLine(i)}
                className="rounded-lg border border-stone-200 px-3 py-2.5 text-left mo-hover-card">
                <span className="block truncate text-sm font-medium">{i.name}</span>
                <span className="block text-sm tabular-nums mo-text-mid">{money(i.price)}</span>
              </button>
            ))}
            {menu.length === 0 && <p className="col-span-full py-6 text-center text-sm text-stone-500">這張表單還沒有預先列出品項，請在下面手動加入</p>}
          </div>
          <div className="flex flex-col gap-2 border-t border-stone-200 p-3 sm:flex-row">
            <input className={inputCls + " min-w-0 sm:w-auto sm:flex-1"} value={custom.name} placeholder="品項"
              onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            <div className="flex gap-2 self-start">
              <input className={inputCls + " w-24 tabular-nums"} type="number" value={custom.price} placeholder="價格"
                onChange={(e) => setCustom({ ...custom, price: e.target.value })} />
              <Btn variant="quiet" onClick={() => {
                if (!custom.name.trim()) return;
                addLine({ name: custom.name.trim(), price: Number(custom.price) || 0 });
                setCustom({ name: "", price: "" });
              }}>加入</Btn>
            </div>
          </div>
        </Panel>
      )}

      <Panel>
        <div className="border-b border-stone-200 px-4 py-3">
          <span className="text-sm font-medium text-stone-700">我的餐點</span>
          <span className="ml-2 text-xs text-stone-500">同一品項不同備註請分開加，店家和統計會分開列</span>
        </div>
        {lines.length === 0 ? (
          <Empty icon={Utensils} title="還沒選餐點" hint="從上面的菜單點一下就會加進來。" />
        ) : (
          <div className="divide-y divide-stone-100">
            {lines.map((l) => (
              <div key={l.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex-1 truncate font-medium">{l.name}</span>
                  <span className="text-sm tabular-nums text-stone-500">{money(l.price)}</span>
                  {!locked && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => (l.qty > 1 ? patch(l.id, { qty: l.qty - 1 }) : drop(l.id))}
                        className="rounded-md border border-stone-300 p-1.5 hover:bg-stone-100"><Minus size={13} /></button>
                      <span className="w-7 text-center tabular-nums font-semibold">{l.qty}</span>
                      <button onClick={() => patch(l.id, { qty: l.qty + 1 })}
                        className="rounded-md border border-stone-300 p-1.5 hover:bg-stone-100"><Plus size={13} /></button>
                    </div>
                  )}
                  {locked && <span className="tabular-nums">×{l.qty}</span>}
                  <span className="w-20 text-right font-semibold tabular-nums">{money(l.qty * l.price)}</span>
                </div>
                {!locked ? (
                  <input className={inputCls + " mt-2"} value={l.note || ""} placeholder="備註，例如：不要香菜、飯少、加辣"
                    onChange={(e) => patch(l.id, { note: e.target.value })} />
                ) : l.note ? (
                  <p className="mt-1 text-sm text-stone-500">備註：{l.note}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-stone-200 px-4 py-4">
          <Field label="整單備註（可留空）">
            <input className={inputCls} value={note} disabled={locked} onChange={(e) => { setNote(e.target.value); setSaved(false); }}
              placeholder="例如：我會晚 10 分鐘到" />
          </Field>
        </div>
      </Panel>

      {!locked && (
        <div className="fixed bottom-14 left-0 right-0 border-t border-stone-200 bg-white px-4 py-3 sm:bottom-0">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-stone-500">總金額</p>
              <p className="text-xl font-semibold tabular-nums">{money(total)}</p>
            </div>
            {existing && <Btn variant="danger" size="sm" onClick={withdraw}>取消訂餐</Btn>}
            <Btn variant={saved ? "quiet" : "accent"} onClick={submit}>
              {saved ? <><Check size={16} />已送出</> : existing ? "更新訂單" : "送出訂單"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 訂餐者：我的帳戶 ---------------- */
function UserWallet({ me, txs, balance }) {
  const mine = txs.filter((t) => t.userId === me.id).sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  const spent = mine.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  return (
    <div>
      <h2 className="mb-5 text-xl font-semibold tracking-tight">我的帳戶</h2>

      <div className="mb-5 rounded-xl mo-bg-solid p-6">
        <p className="text-sm mo-text-ondark">目前餘額</p>
        <p className={`mt-1 text-4xl font-semibold tabular-nums ${balance < 0 ? "text-red-200" : "text-white"}`}>{money(balance)}</p>
        <p className="mt-3 text-sm mo-text-ondark tabular-nums">累計消費 {money(Math.abs(spent))}</p>
        {balance < 0 && <p className="mt-3 rounded-lg bg-red-900 px-3 py-2 text-sm text-red-100">餘額已透支，記得找管理員儲值。</p>}
      </div>

      <h3 className="mb-2 text-sm font-medium text-stone-500">扣款明細</h3>
      {mine.length === 0 ? (
        <Panel><Empty icon={Receipt} title="還沒有任何紀錄" hint="訂餐結算或儲值之後，明細會出現在這裡。" /></Panel>
      ) : (
        <Panel><LedgerTable rows={mine} /></Panel>
      )}
    </div>
  );
}
