import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Utensils, Users, Wallet, Receipt, Shield, User, RefreshCw, Plus, Minus,
  Trash2, Check, X, ChevronLeft, Upload, Loader2, ClipboardList, Calendar,
  Lock, LogOut, Settings, Search, FileText, ImageIcon, CircleDollarSign, Copy, Download, Edit3,
} from "lucide-react";

/* ---------------- storage ----------------
   資料存在後端（Vercel KV），所有使用者共用同一份，透過 /api/state 讀寫。 */
const API_BASE = "/api";
const DEFAULT_STATE = { users: [], forms: [], tx: [], cfg: { pin: "0000", title: "今天吃什麼" } };

async function fetchState() {
  try {
    const res = await fetch(`${API_BASE}/state`);
    if (!res.ok) throw new Error("讀取失敗 " + res.status);
    const data = await res.json();
    return { ...DEFAULT_STATE, ...data };
  } catch (e) {
    console.error("讀取資料失敗", e);
    return DEFAULT_STATE;
  }
}
async function saveState(key, value) {
  try {
    const res = await fetch(`${API_BASE}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    return res.ok;
  } catch (e) {
    console.error("儲存失敗", key, e);
    return false;
  }
}

/* ---------------- utils ---------------- */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => (n < 0 ? "-" : "") + "NT$" + Math.abs(Math.round(n)).toLocaleString("en-US");
const lineKey = (l) => `${l.name}||${(l.note || "").trim()}`;

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
              <input className={inputCls + " flex-1 font-medium"} value={i.name} placeholder="品項名稱，例如：招牌焢肉飯"
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

/* ---------------- menu recognition ----------------
   實際呼叫 Anthropic API 的動作在後端 /api/recognize-menu 完成（API 金鑰只存在伺服器上）。 */
async function recognizeMenu(base64, mediaType) {
  const res = await fetch(`${API_BASE}/recognize-menu`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64, mediaType }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("辨識服務回應 " + res.status));
  return {
    shop: data.shop || "",
    items: (data.items || []).map((i) => ({
      id: uid(), name: String(i.name || "").trim(), price: Number(i.price) || 0, group: i.group || "",
    })).filter((i) => i.name),
  };
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
  const [cfg, setCfg] = useState({ pin: "0000", title: "今天吃什麼" });

  const [role, setRole] = useState(null);       // 'admin' | 'user'
  const [meId, setMeId] = useState(null);
  const [tab, setTab] = useState("forms");
  const [openFormId, setOpenFormId] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async (silent) => {
    if (!silent) setSyncing(true);
    const s = await fetchState();
    setUsers(s.users); setForms(s.forms); setTxs(s.tx); setCfg(s.cfg);
    setSyncedAt(new Date());
    setSyncing(false);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(true); }, [refresh]);

  // 即時同步：每 12 秒拉一次，讓多人填的表單會自動彙整進來
  useEffect(() => {
    const i = setInterval(() => refresh(true), 12000);
    return () => clearInterval(i);
  }, [refresh]);

  const saveUsers = async (next) => { setUsers(next); await saveState("users", next); };
  const saveForms = async (next) => { setForms(next); await saveState("forms", next); };
  const saveTxs = async (next) => { setTxs(next); await saveState("tx", next); };
  const saveCfg = async (next) => { setCfg(next); await saveState("cfg", next); };

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
    { id: "daily", label: "每日結算", icon: Calendar },
    { id: "people", label: "成員儲值", icon: Users },
    { id: "ledger", label: "扣款明細", icon: Receipt },
    { id: "settings", label: "設定", icon: Settings },
  ];
  const navUser = [
    { id: "order", label: "我要訂餐", icon: Utensils },
    { id: "wallet", label: "我的帳戶", icon: Wallet },
  ];
  const nav = role === "admin" ? navAdmin : navUser;

  const exit = () => { setRole(null); setMeId(null); setOpenFormId(null); };

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
        {role === "admin" && tab === "people" && <People users={users} balances={balances} txs={txs} saveUsers={saveUsers} saveTxs={saveTxs} />}
        {role === "admin" && tab === "ledger" && <AdminLedger txs={txs} users={users} />}
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
            最後同步 {syncedAt.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}，每 12 秒自動更新
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
  const [q, setQ] = useState("");

  const list = users.filter((u) => u.name.includes(q));

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
                onKeyDown={(e) => { if (e.key === "Enter") { pin === (cfg.pin || "0000") ? onAdmin() : setErr("密碼不對，預設是 0000"); } }}
                placeholder="預設 0000" />
            </Field>
            {err && <p className="mt-2 text-sm text-red-800">{err}</p>}
            <div className="mt-4 flex gap-2">
              <Btn variant="quiet" onClick={() => setMode(null)}>返回</Btn>
              <Btn className="flex-1" onClick={() => (pin === (cfg.pin || "0000") ? onAdmin() : setErr("密碼不對，預設是 0000"))}>進入管理</Btn>
            </div>
          </div>
        )}

        {mode === "user" && (
          <div className="rounded-xl bg-white p-5">
            {users.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-stone-600">還沒有任何訂餐者。請管理員先到「成員儲值」建立名單。</p>
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
  const sorted = [...forms].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  const remove = async (id) => {
    const ok = await askConfirm({ title: "刪除這張表單？", body: "表單與裡面的訂單會消失。已結算的扣款紀錄會保留在扣款明細裡。", danger: true, confirmLabel: "刪除表單" });
    if (!ok) return;
    await saveForms(forms.filter((f) => f.id !== id));
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
          hint="上傳一張菜單照片，系統會讀出品項和價格，直接變成可以填的訂餐表單。"
          action={<Btn onClick={() => setCreating(true)}><Upload size={16} />上傳菜單建立表單</Btn>} /></Panel>
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
                        : f.closed
                          ? <span className="shrink-0 rounded-md bg-stone-200 px-2 py-0.5 text-xs text-stone-600">已截止</span>
                          : <span className="shrink-0 rounded-md mo-chip-solid px-2 py-0.5 text-xs">收單中</span>}
                    </div>
                    <p className="mt-1 text-sm text-stone-500 tabular-nums">
                      {f.date}　{f.orders.length} 人已填　合計 {money(total)}
                    </p>
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
        await saveForms([form, ...forms]); setCreating(false);
      }} />
    </div>
  );
}

/* ---------------- 建立表單（菜單辨識） ---------------- */
function CreateForm({ open, onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) { setTitle(""); setDate(today()); setItems([]); setErr(""); setPreview(null); }
  }, [open]);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setErr(""); setBusy(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.onerror = () => rej(new Error("讀取圖片失敗"));
        r.readAsDataURL(file);
      });
      const rawUrl = `data:${file.type};base64,${base64}`;
      const compressed = await resizeImage(rawUrl);
      setPreview(compressed || rawUrl);
      const out = await recognizeMenu(base64, file.type);
      setItems(out.items);
      if (!title && out.shop) setTitle(out.shop);
      if (out.items.length === 0) setErr("這張圖沒讀到品項，請手動加入。");
    } catch (e2) {
      setErr("菜單讀取失敗：" + e2.message + "。可以直接手動加品項。");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const create = () => {
    const clean = items.filter((i) => i.name.trim());
    if (!title.trim()) return setErr("先幫這張表單取個名字。");
    if (clean.length === 0) return setErr("至少要有一個品項。");
    onCreate({
      id: uid(), title: title.trim(), date, createdAt: new Date().toISOString(),
      items: clean.map((i) => ({ ...i, name: i.name.trim(), price: Number(i.price) || 0 })),
      orders: [], closed: false, settled: false, menuImage: preview || null,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="新增訂餐表單" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="表單名稱"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：阿姨自助餐" /></Field>
        <Field label="訂餐日期"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>

      <div className="mt-5 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-5 text-center">
        {preview && <img src={preview} alt="菜單" className="mx-auto mb-4 max-h-48 rounded-lg" />}
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" id="menu-file" />
        <Btn variant="accent" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
          {busy ? <><Loader2 size={16} className="animate-spin" />讀取菜單中</> : <><Upload size={16} />上傳菜單照片</>}
        </Btn>
        <p className="mt-2 text-xs text-stone-500">拍一張菜單就好，系統會自動列出品項與價格，你再校對。</p>
      </div>

      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}

      <div className="mt-5">
        <ItemRows items={items} setItems={setItems} emptyHint={busy ? "辨識中…" : "還沒有品項，可上傳菜單或手動加入"} />
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
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant") || a.note.localeCompare(b.note, "zh-Hant"));
  }, [form]);

  if (!form) return <Empty icon={FileText} title="找不到這張表單" action={<Btn onClick={onBack}>返回</Btn>} />;

  const total = form.orders.reduce((s, o) => s + o.total, 0);

  // 打電話念的版本：一行一個品項，備註不同會分開列
  const phoneText = [
    `${form.title}　${form.date}`,
    "",
    ...stats.map((s) => `${s.name}${s.note ? `（${s.note}）` : ""} ${s.qty} 份`),
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

  const toggleClosed = async () => {
    await saveForms(forms.map((f) => (f.id === form.id ? { ...f, closed: !f.closed } : f)));
  };

  const settle = async () => {
    if (form.settled) return;
    if (form.orders.length === 0) return askNotice("還沒有人填單", "至少要有一筆訂單才能結算。");
    const names = form.orders.map((o) => `${o.userName} ${money(o.total)}`).join("\n");
    const ok = await askConfirm({ title: "確認扣款", body: `以下金額會從各自的儲值金扣除：\n\n${names}\n\n合計 ${money(total)}\n\n扣款後這張表單就會鎖住。`, confirmLabel: "確認扣款" });
    if (!ok) return;
    const stamp = new Date().toISOString();
    const newTxs = form.orders.map((o) => ({
      id: uid(), userId: o.userId, userName: o.userName, date: form.date, ts: stamp,
      amount: -o.total, type: "order", reason: form.title, formId: form.id,
      items: o.lines.map((l) => ({ name: l.name, note: l.note || "", qty: l.qty, price: l.price })),
    }));
    await saveTxs([...newTxs, ...txs]);
    await saveForms(forms.map((f) => (f.id === form.id ? { ...f, settled: true, closed: true, settledAt: stamp } : f)));
  };

  const removeOrder = async (oid) => {
    if (form.settled) return;
    const ok = await askConfirm({ title: "刪除這筆訂單？", body: "這個人就不算在這張表單裡了。", danger: true, confirmLabel: "刪除" });
    if (!ok) return;
    await saveForms(forms.map((f) => (f.id === form.id ? { ...f, orders: f.orders.filter((o) => o.id !== oid) } : f)));
  };

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900">
        <ChevronLeft size={16} />所有表單
      </button>

      <Panel className="mb-5 p-5">
        <div className="flex flex-wrap items-start gap-4">
          {form.menuImage && (
            <MenuImage src={form.menuImage} className="h-20 w-20 shrink-0" label={`${form.title} 菜單照片`} />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight">{form.title}</h2>
            <p className="mt-1 text-sm text-stone-500 tabular-nums">{form.date}　{form.orders.length} 人已填</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums mo-text-strong">{money(total)}</p>
            <p className="text-xs text-stone-500">這張表單總金額</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!form.settled && <Btn variant="quiet" size="sm" onClick={toggleClosed}>{form.closed ? "重新開放填單" : "停止收單"}</Btn>}
          {!form.settled && <Btn variant="quiet" size="sm" onClick={() => setEditingMenu(true)}><Edit3 size={14} />編輯品項</Btn>}
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
        onSave={async (items, menuImage) => {
          await saveForms(forms.map((f) => (f.id === form.id ? { ...f, items, menuImage } : f)));
          setEditingMenu(false);
        }} />

      {view === "people" && (
        <Panel>
          {form.orders.length === 0 ? <Empty icon={Users} title="還沒有人填單" /> : (
            <div className="divide-y divide-stone-100">
              {form.orders.map((o) => (
                <div key={o.id} className="flex gap-4 px-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{o.userName}</span>
                      <span className="text-xs text-stone-400 tabular-nums">
                        目前餘額 {money(balances[o.userId] || 0)}
                      </span>
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
                      <button onClick={() => removeOrder(o.id)} className="mt-1 text-xs text-stone-400 hover:text-red-800">刪除</button>
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

function MenuEditModal({ open, onClose, form, onSave }) {
  const [items, setItems] = useState([]);
  const [menuImage, setMenuImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open && form) { setItems(form.items.map((i) => ({ ...i }))); setMenuImage(form.menuImage || null); }
  }, [open, form]);

  if (!form) return null;

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
      setMenuImage(compressed || dataUrl);
    } catch (e2) {
      await askNotice("圖片讀取失敗", e2.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`編輯「${form.title}」的品項`} wide>
      <p className="mb-4 text-sm text-stone-500">
        改價格或加品項不會動到已經填好的訂單，那些訂單保留當時的價格。要更新舊訂單請該成員重新送出。
      </p>

      <div className="mb-5">
        <span className="mb-1.5 block text-sm font-medium text-stone-700">菜單照片</span>
        <div className="flex items-center gap-3">
          {menuImage
            ? <MenuImage src={menuImage} className="h-20 w-20" label="菜單照片" />
            : <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-stone-300 text-stone-400"><ImageIcon size={22} /></div>}
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
            <Btn size="sm" variant="quiet" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
              {busy ? <><Loader2 size={14} className="animate-spin" />處理中</> : <><Upload size={14} />{menuImage ? "更換照片" : "上傳照片"}</>}
            </Btn>
            {menuImage && <button onClick={() => setMenuImage(null)} className="text-left text-xs text-stone-400 hover:text-red-800">移除照片</button>}
          </div>
        </div>
      </div>

      <ItemRows items={items} setItems={setItems} />
      <div className="mt-6 flex justify-end gap-2">
        <Btn variant="quiet" onClick={onClose}>取消</Btn>
        <Btn onClick={() => onSave(items.filter((i) => String(i.name).trim())
          .map((i) => ({ ...i, name: String(i.name).trim(), price: Number(i.price) || 0 })), menuImage)}>儲存</Btn>
      </div>
    </Modal>
  );
}

/* ---------------- 每日結算 ---------------- */
function DailySettlement({ forms, txs, users }) {
  const [date, setDate] = useState(today());

  const dayForms = forms.filter((f) => f.date === date);
  const rows = useMemo(() => {
    const m = new Map();
    dayForms.forEach((f) => {
      f.orders.forEach((o) => {
        if (!m.has(o.userId)) m.set(o.userId, { userId: o.userId, name: o.userName, total: 0, detail: [] });
        const r = m.get(o.userId);
        r.total += o.total;
        r.detail.push({ form: f.title, settled: f.settled, total: o.total, lines: o.lines });
      });
    });
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [dayForms]);

  const sum = rows.reduce((s, r) => s + r.total, 0);

  const exportRows = [
    ["日期", "訂餐人", "表單", "品項", "備註", "數量", "單價", "小計", "扣款狀態"],
    ...rows.flatMap((r) => r.detail.flatMap((d) => d.lines.map((l) => [
      date, r.name, d.form, l.name, l.note || "", l.qty, l.price, l.qty * l.price, d.settled ? "已扣款" : "未扣款",
    ]))),
    [],
    ["日期", "訂餐人", "當日應付"],
    ...rows.map((r) => [date, r.name, r.total]),
    ["", "合計", sum],
  ];
  const csv = toCsv(exportRows);
  const tsv = exportRows.map((r) => r.join("\t")).join("\n");

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">每日結算</h2>
          <p className="mt-1 text-sm text-stone-500">把當天所有表單合起來，看每個人要付多少。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className={inputCls + " w-auto"} value={date} onChange={(e) => setDate(e.target.value)} />
          {rows.length > 0 && (
            <>
              <Btn size="sm" variant="quiet" onClick={() => downloadText(`每日結算-${date}.csv`, csv, "text/csv")}>
                <Download size={14} />匯出 CSV
              </Btn>
              <CopyButton label="複製成表格" text={tsv} filename={`每日結算-${date}.csv`} mime="text/csv" />
            </>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <Panel><Empty icon={Calendar} title={`${date} 沒有訂餐紀錄`} hint="換一個日期，或先建立表單。" /></Panel>
      ) : (
        <>
          <Panel className="mb-4 p-5">
            <p className="text-sm text-stone-500">{date} 共 {rows.length} 人、{dayForms.length} 張表單</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums mo-text-strong">{money(sum)}</p>
          </Panel>
          <Panel>
            <div className="divide-y divide-stone-100">
              {rows.map((r) => (
                <div key={r.userId} className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-lg font-semibold tabular-nums">{money(r.total)}</span>
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    {r.detail.map((d, i) => (
                      <p key={i} className="text-sm text-stone-600 tabular-nums">
                        <span className="text-stone-400">{d.form}</span>
                        {d.lines.map((l) => `${l.name}${l.note ? `（${l.note}）` : ""}×${l.qty}`).join("、")}　{money(d.total)}
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

function People({ users, balances, txs, saveUsers, saveTxs }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [initial, setInitial] = useState("");
  const [target, setTarget] = useState(null);

  const addUser = async () => {
    if (!name.trim()) return;
    const u = { id: uid(), name: name.trim(), createdAt: new Date().toISOString() };
    await saveUsers([...users, u]);
    const amt = Number(initial) || 0;
    if (amt !== 0) {
      await saveTxs([{
        id: uid(), userId: u.id, userName: u.name, date: today(), ts: new Date().toISOString(),
        amount: amt, type: "adjust", reason: "起始儲值金", items: [],
      }, ...txs]);
    }
    setName(""); setInitial(""); setAdding(false);
  };

  const removeUser = async (u) => {
    const ok = await askConfirm({ title: `刪除 ${u.name}？`, body: "這個人的儲值紀錄和扣款明細會一起移除，無法復原。", danger: true, confirmLabel: "刪除成員" });
    if (!ok) return;
    await saveUsers(users.filter((x) => x.id !== u.id));
    await saveTxs(txs.filter((t) => t.userId !== u.id));
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
                <div key={u.id} className="flex items-center gap-3 px-4 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full mo-bg-solid text-sm font-semibold mo-text-ondark-strong">
                    {u.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{u.name}</p>
                    <p className={`text-sm tabular-nums ${b < 0 ? "text-red-800" : b < 100 ? "mo-text-mid" : "text-stone-500"}`}>
                      餘額 {money(b)}{b < 0 ? "　已透支" : b < 100 ? "　該儲值了" : ""}
                    </p>
                  </div>
                  <Btn size="sm" variant="quiet" onClick={() => setTarget(u)}>調整儲值金</Btn>
                  <button onClick={() => removeUser(u)} className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-800"><Trash2 size={16} /></button>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="新增成員">
        <div className="space-y-4">
          <Field label="姓名"><input className={inputCls} value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="例如：王小明" /></Field>
          <Field label="起始儲值金" hint="之後每天訂餐會從這裡扣。可以先填 0。">
            <input className={inputCls + " tabular-nums"} type="number" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="0" />
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Btn variant="quiet" onClick={() => setAdding(false)}>取消</Btn>
          <Btn onClick={addUser}>新增</Btn>
        </div>
      </Modal>

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
          有 {negatives.length} 人已透支：{negatives.map((u) => u.name).join("、")}。透支金額已經算進上面的總額，核對現金時記得扣掉。
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
function AdminLedger({ txs, users }) {
  const [who, setWho] = useState("all");
  const [kind, setKind] = useState("all");

  const rows = txs
    .filter((t) => (who === "all" ? true : t.userId === who))
    .filter((t) => (kind === "all" ? true : kind === "order" ? t.type === "order" : t.type !== "order"))
    .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">扣款明細</h2>
        <p className="mt-1 text-sm text-stone-500">所有人的每一筆進出，含日期、品項與金額。</p>
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
        <Panel><LedgerTable rows={rows} showName /></Panel>
      )}
    </div>
  );
}

function LedgerTable({ rows, showName }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-stone-500">
            <th className="px-4 py-3 font-medium">日期</th>
            {showName && <th className="px-4 py-3 font-medium">成員</th>}
            <th className="px-4 py-3 font-medium">品項／原因</th>
            <th className="px-4 py-3 text-right font-medium">金額</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-stone-100 last:border-0 align-top">
              <td className="whitespace-nowrap px-4 py-3 tabular-nums text-stone-600">{t.date}</td>
              {showName && <td className="whitespace-nowrap px-4 py-3 font-medium">{t.userName}</td>}
              <td className="px-4 py-3">
                {t.type === "order" ? (
                  <>
                    <span className="text-xs text-stone-400">{t.reason}</span>
                    <ul className="mt-0.5 space-y-0.5">
                      {(t.items || []).map((l, i) => (
                        <li key={i}>
                          {l.name} ×{l.qty}
                          {l.note && <span className="ml-1.5 rounded mo-badge px-1.5 py-0.5 text-xs">{l.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-700">{t.reason}</span>
                    {t.note && <span className="ml-2 text-xs text-stone-500">{t.note}</span>}
                  </>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right"><Money v={t.amount} strong /></td>
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
  const [pin, setPin] = useState(cfg.pin || "0000");
  const [saved, setSaved] = useState(false);

  return (
    <div className="max-w-lg">
      <h2 className="mb-5 text-xl font-semibold tracking-tight">設定</h2>
      <Panel className="space-y-4 p-5">
        <Field label="網站名稱"><input className={inputCls} value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} /></Field>
        <Field label="管理員密碼" hint="訂餐者不需要密碼，只有管理端要。">
          <input className={inputCls} value={pin} onChange={(e) => { setPin(e.target.value); setSaved(false); }} />
        </Field>
        <div className="flex items-center gap-3">
          <Btn onClick={async () => { await saveCfg({ ...cfg, title: title.trim() || "今天吃什麼", pin: pin || "0000" }); setSaved(true); }}>儲存設定</Btn>
          {saved && <span className="flex items-center gap-1 text-sm mo-text-strong"><Check size={15} />已儲存</span>}
        </div>
      </Panel>

      <Panel className="mt-5 p-5">
        <p className="text-sm font-medium text-stone-800">清除全部資料</p>
        <p className="mt-1 text-sm text-stone-500">刪除所有成員、表單與帳務紀錄，無法復原。</p>
        <div className="mt-3">
          <Btn variant="danger" size="sm" onClick={async () => { if (await askConfirm({ title: "清除全部資料？", body: "所有成員、表單與帳務紀錄都會刪除，無法復原。", danger: true, confirmLabel: "全部清除" })) onWipe(); }}>清除全部資料</Btn>
        </div>
      </Panel>
    </div>
  );
}

/* ---------------- 訂餐者：表單列表 ---------------- */
function UserForms({ forms, me, onOpen }) {
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
                  {f.closed
                    ? <span className="rounded-md bg-stone-200 px-2 py-0.5 text-xs text-stone-600">已截止</span>
                    : o
                      ? <span className="rounded-md bg-stone-200 px-2 py-0.5 text-xs text-stone-700">已填 {money(o.total)}</span>
                      : <span className="rounded-md mo-btn-accent px-2 py-0.5 text-xs font-medium">還沒填</span>}
                </div>
                <p className="mt-1 text-sm text-stone-500 tabular-nums">{f.date}　{f.items.length} 個品項</p>
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
  const [q, setQ] = useState("");

  if (!form) return <Empty icon={FileText} title="找不到這張表單" action={<Btn onClick={onBack}>返回</Btn>} />;

  const locked = form.closed || form.settled;
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
    const order = {
      id: existing ? existing.id : uid(),
      userId: me.id, userName: me.name,
      lines: lines.map((l) => ({ name: l.name, price: Number(l.price) || 0, qty: l.qty, note: (l.note || "").trim() })),
      total, note: note.trim(), updatedAt: new Date().toISOString(),
    };
    const next = forms.map((f) => {
      if (f.id !== form.id) return f;
      const others = f.orders.filter((o) => o.userId !== me.id);
      return { ...f, orders: [...others, order] };
    });
    await saveForms(next);
    setSaved(true);
  };

  const withdraw = async () => {
    const ok = await askConfirm({ title: "取消這次訂餐？", body: "你填的內容會從這張表單移除。", danger: true, confirmLabel: "取消訂餐" });
    if (!ok) return;
    await saveForms(forms.map((f) => (f.id === form.id ? { ...f, orders: f.orders.filter((o) => o.userId !== me.id) } : f)));
    onBack();
  };

  const menu = form.items.filter((i) => i.name.includes(q));

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
            {form.settled ? "這張表單已結算，無法再更改。" : "已經截止收單了，要補點請找管理員。"}
          </p>
        )}
      </div>

      <MenuImageBanner src={form.menuImage} />

      {!locked && (
        <Panel className="mb-5">
          <div className="border-b border-stone-200 p-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-3 text-stone-400" />
              <input className={inputCls + " pl-9"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋菜單" />
            </div>
          </div>
          <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
            {menu.map((i) => (
              <button key={i.id} onClick={() => addLine(i)}
                className="rounded-lg border border-stone-200 px-3 py-2.5 text-left mo-hover-card">
                <span className="block truncate text-sm font-medium">{i.name}</span>
                <span className="block text-sm tabular-nums mo-text-mid">{money(i.price)}</span>
              </button>
            ))}
            {menu.length === 0 && <p className="col-span-full py-6 text-center text-sm text-stone-500">菜單上沒有這一項</p>}
          </div>
          <div className="flex gap-2 border-t border-stone-200 p-3">
            <input className={inputCls + " flex-1"} value={custom.name} placeholder="菜單沒有的品項"
              onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            <input className={inputCls + " w-24 tabular-nums"} type="number" value={custom.price} placeholder="價格"
              onChange={(e) => setCustom({ ...custom, price: e.target.value })} />
            <Btn variant="quiet" onClick={() => {
              if (!custom.name.trim()) return;
              addLine({ name: custom.name.trim(), price: Number(custom.price) || 0 });
              setCustom({ name: "", price: "" });
            }}>加入</Btn>
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
