// 菜單照片原本是整段 base64 塞在 forms 裡，每次同步都要整包搬一次（目前 5 張表單就 2 MB）。
// 改成每張照片獨立存在 img:<表單 id> 這個 key，forms 裡只留 hasImage / imgVer，照片要看的時候才用 /api/image 載入。

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const IMG_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG_CHARS = 2_500_000;

export const imgKey = (id) => `img:${id}`;
export const isInlineImage = (f) => !!f && typeof f.menuImage === "string" && f.menuImage.length > 0;

// 回傳給瀏覽器用：把還沒搬走的內嵌照片拿掉，換成「有照片」的標記
export function stripInlineImages(forms) {
  if (!Array.isArray(forms)) return forms;
  return forms.map((f) => (isInlineImage(f) ? { ...f, menuImage: null, hasImage: true, imgVer: f.imgVer || 1 } : f));
}

// 寫入前呼叫：把內嵌的照片存到獨立的 key，回傳瘦身後的表單。格式不對或太大的照片直接丟掉。
export async function externalizeImages(redis, forms) {
  if (!Array.isArray(forms)) return forms;
  const out = [];
  for (const f of forms) {
    if (!isInlineImage(f)) { out.push(f); continue; }
    const ok = ID_RE.test(String(f.id)) && f.menuImage.length <= MAX_IMG_CHARS && IMG_RE.test(f.menuImage);
    if (ok) {
      await redis.set(imgKey(f.id), f.menuImage);
      out.push({ ...f, menuImage: null, hasImage: true, imgVer: Date.now() });
    } else {
      out.push({ ...f, menuImage: null, hasImage: false });
    }
  }
  return out;
}

// 把資料庫裡「已經存好」的舊表單搬家（舊資料的照片都還內嵌在 forms 裡）。
// 寫回前再讀一次確認沒被別人改過，被改過就這次先不動，下次再搬。
export async function normalizeStoredForms(redis) {
  const before = await redis.get("forms");
  if (!Array.isArray(before) || !before.some(isInlineImage)) return false;
  const slim = await externalizeImages(redis, before);
  const again = await redis.get("forms");
  if (JSON.stringify(again) !== JSON.stringify(before)) return false;
  await redis.set("forms", slim);
  return true;
}

// 把 data URL 拆成 { mime, buffer }，不合法回傳 null
export function decodeImage(dataUrl) {
  if (typeof dataUrl !== "string" || !IMG_RE.test(dataUrl)) return null;
  const comma = dataUrl.indexOf(",");
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  return { mime, buffer: Buffer.from(dataUrl.slice(comma + 1), "base64") };
}

export const isValidFormId = (id) => ID_RE.test(String(id));
