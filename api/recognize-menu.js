// Anthropic API 金鑰只存在這個伺服器端函式裡（Vercel 環境變數），不會傳到瀏覽器。
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "伺服器尚未設定 ANTHROPIC_API_KEY，請到 Vercel 專案的 Environment Variables 設定。" });
    return;
  }

  const { image, mediaType } = req.body || {};
  if (!image || !mediaType) {
    res.status(400).json({ error: "缺少圖片資料" });
    return;
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            {
              type: "text",
              text: `讀取這張菜單圖片，抓出店名與所有餐點品項與價格。
只輸出 JSON，不要任何說明文字或 markdown 標記。格式：
{"shop":"店名，看不出來就空字串","items":[{"name":"品項名稱","price":數字,"group":"分類，沒有就空字串"}]}
價格一律是整數台幣。看不清楚價格的品項 price 填 0。`,
            },
          ],
        }],
      }),
    });

    if (!anthropicRes.ok) {
      const text = await anthropicRes.text().catch(() => "");
      res.status(anthropicRes.status).json({ error: `辨識服務回應 ${anthropicRes.status}：${text.slice(0, 300)}` });
      return;
    }

    const data = await anthropicRes.json();
    const text = (data.content || []).map((c) => (c.type === "text" ? c.text : "")).join("");
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start === -1 || end === -1) {
      res.status(502).json({ error: "辨識結果格式錯誤，請再試一次或手動輸入。" });
      return;
    }

    const parsed = JSON.parse(clean.slice(start, end + 1));
    res.status(200).json({ shop: parsed.shop || "", items: parsed.items || [] });
  } catch (e) {
    console.error("recognize-menu error", e);
    res.status(500).json({ error: e.message || "辨識失敗" });
  }
}
