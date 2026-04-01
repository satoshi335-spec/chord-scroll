module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { base64, mediaType, fileType } = req.body;
  if (!base64 || !mediaType) return res.status(400).json({ error: 'Missing data' });

  const prompt = 'このファイルはギターのコード譜です。コードと歌詞を以下の形式のテキストに変換してください。\n\n出力形式（必ずこの形式のみ）:\ntitle: 曲名（わかれば）\nkey: キー（わかれば、例: F）\ncapo: カポ番号（わかれば）\n\n[セクション名]\n[コード]歌詞[コード]歌詞...\n\nルール:\n- コードは必ず歌詞の中に埋め込む。コードを歌詞の後（下の行）に出力してはいけない\n- コードが歌詞の上にある場合：対応する歌詞の文字の直前に [コード] を埋め込む\n- コードが歌詞の下にある場合：その歌詞の先頭または対応する位置に [コード] を埋め込む\n- 【絶対禁止】歌詞行の次の行にコードだけを並べること。必ず歌詞の中に埋め込む\n- 例（コードが上）: Bbが行頭、Cが「花」の上 → [Bb]すみれの[C]花時計\n- 例（コードが下）: 歌詞「踊るまわるフロア」の下にF#m B C#m → [F#m]踊るまわる[B]フロア[C#m]\n- 歌詞がなくコードのみの行は [Fsus4] [F] のように並べる\n- セクション（Verse/Chorus/間奏等）は [セクション名] で囲む\n- 複数ページある場合はすべて変換する\n- 余計な説明文は不要。変換結果のみ出力する';

  const contentBlock = (fileType === 'pdf')
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [ contentBlock, { type: 'text', text: prompt } ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: 'Claude API error ' + response.status + ': ' + errText.slice(0, 200) });
    }

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = data.content.map(function(b) { return b.text || ''; }).join('').trim();
    return res.status(200).json({ result: text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
