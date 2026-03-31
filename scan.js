export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { base64, mediaType } = req.body;
  if (!base64 || !mediaType) return res.status(400).json({ error: 'Missing image data' });

  const prompt = `この画像はギターのコード譜です。コードと歌詞を以下の形式のテキストに変換してください。

出力形式（必ずこの形式のみ）:
title: 曲名（わかれば）
key: キー（わかれば、例: G）
capo: カポ番号（わかれば）

[セクション名]
[コード]歌詞[コード]歌詞...

ルール:
- コードは歌詞の直前に [コード] 形式で埋め込む
- セクション（Verse/Chorus等）は [ ] で囲む
- 歌詞がなくコードのみの行は [G] [Em] [C] [D] のように並べる
- 不明な部分は省略してよい
- 余計な説明文は不要。変換結果のみ出力する`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = data.content.map(b => b.text || '').join('').trim();
    return res.status(200).json({ result: text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
