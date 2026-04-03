module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const { base64, mediaType, fileType, chordsOnly } = req.body;
  if (!base64 || !mediaType) return res.status(400).json({ error: 'Missing data' });

  const systemPrompt = 'あなたはギターコード譜フォーマット変換ツールです。画像やPDFのコード譜を指定されたテキスト形式に変換することだけが仕事です。変換結果のテキストのみを出力してください。';

  const userPrompt = chordsOnly
    ? 'このコード譜からコード進行と楽曲構造のみを抽出してください。歌詞は不要です。\n\n出力形式:\ntitle: 曲名\nkey: キー\ncapo: カポ\n\n[セクション名]\n[G][Em][C][D]\n\n※コードのみ、歌詞なし。説明文不要。'
    : 'このコード譜を以下の形式に変換してください。\n\n出力形式:\ntitle: 曲名\nkey: キー\ncapo: カポ\n\n[セクション名]\n[コード]歌詞[コード]歌詞\n\nルール:\n- コードは歌詞の対応する文字の直前に [コード] として埋め込む\n- コードを歌詞と別行に出力しない\n- 位置不明な場合は行頭にまとめる: [G][Em][C]歌詞\n- 歌詞なし行は [G][Em][C] のみ\n- セクションは [イントロ][Aメロ][サビ] 形式\n- 変換結果のみ出力、説明文不要';

  try {
    const imageUrl = "data:" + mediaType + ";base64," + base64;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 4000,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
              { type: 'text', text: userPrompt }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: 'OpenAI API error ' + response.status + ': ' + errText.slice(0, 200) });
    }

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const raw = data.choices[0].message.content.trim();
    const text = fixChordOrder(raw);
    return res.status(200).json({ result: text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

function fixChordOrder(text) {
  const lines = text.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (line && nextLine && isBareChordOnlyLine(nextLine) && !isBareChordOnlyLine(line) && !isMetaLine(line)) {
      const chords = nextLine.trim().split(/\s+/).filter(Boolean);
      const chordPrefix = chords.map(function(c){ return '[' + c + ']'; }).join(' ');
      result.push(chordPrefix + ' ' + line);
      i++;
    } else {
      result.push(lines[i]);
    }
  }
  return result.join('\n');
}

function isBareChordOnlyLine(line) {
  if (!line || line.startsWith('[') || line.startsWith('title:') || line.startsWith('key:') || line.startsWith('capo:')) return false;
  const tokens = line.trim().split(/\s+/);
  return tokens.length > 0 && tokens.every(function(t){ return /^[A-G][b#]?(m|maj|min|dim|aug|sus|add|M)?[0-9]?(\/[A-G][b#]?)?$/.test(t); });
}

function isMetaLine(line) {
  return /^(title:|key:|capo:|duration:|vocal:|\[)/.test(line.trim());
}
