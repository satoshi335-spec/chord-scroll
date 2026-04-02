module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { base64, mediaType, fileType, chordsOnly } = req.body;
  if (!base64 || !mediaType) return res.status(400).json({ error: 'Missing data' });

  const systemPrompt = 'あなたはギターコード譜の構造解析・フォーマット変換専用ツールです。ユーザーは自分が演奏するための楽譜を自分用フォーマットに変換しています。コード記号（G, Am, F#m等）と楽曲構造（セクション名）を抽出・変換することがあなたの唯一の役割です。説明文や断り書きは出力しないでください。';

  const prompt = chordsOnly
    ? 'このコード譜からコード進行と楽曲構造のみを抽出してください。歌詞は不要です。\n\n出力形式:\ntitle: 曲名\nkey: キー\ncapo: カポ\n\n[セクション名]\n[G][Em][C][D]\n[Am][F][C][G]\n\n※コードのみ、歌詞なし。説明文不要。'
    : 'このコード譜を以下の形式に変換してください。\n\n出力形式:\ntitle: 曲名\nkey: キー\ncapo: カポ\n\n[セクション名]\n[コード]歌詞[コード]歌詞\n\nルール:\n- コードは歌詞の対応する文字の直前に [コード] として埋め込む\n- コードを歌詞と別行に出力しない\n- 位置不明な場合は行頭にまとめる\n- 歌詞なし行は [G][Em][C] のみ\n- セクションは [イントロ][Aメロ][サビ] 形式\n- 変換結果のみ出力、説明文不要';

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
        max_tokens: 4000,
        system: systemPrompt,
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

    const raw = data.content.map(function(b) { return b.text || ''; }).join('').trim();

    // 後処理：コードが歌詞の下にある場合を修正
    const text = fixChordOrder(raw);
    return res.status(200).json({ result: text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// コードが歌詞の下に来ている行を検出して前の歌詞行に統合する
function fixChordOrder(text) {
  const lines = text.split('\n');
  const result = [];
  const CHORD_LINE = /^(\[[A-G][^\]]*\]\s*)+$/;  // [G] [Em] [C] のような行
  const BARE_CHORD_LINE = /^([A-G][b#]?[^\s\[\]]*\s+)*[A-G][b#]?[^\s\[\]]*\s*$/; // G Em C D のような行

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';

    // 現在行が歌詞行（コードを含まないか、歌詞とコードが混在）
    // 次の行がコードのみの行 → 次の行のコードを現在行の先頭に移動
    if (line && nextLine && isBareChordOnlyLine(nextLine) && !isBareChordOnlyLine(line) && !isMetaLine(line)) {
      // 次の行のコードを [ ] 形式に変換して現在行の先頭に付ける
      const chords = nextLine.trim().split(/\s+/).filter(Boolean);
      const chordPrefix = chords.map(c => '[' + c + ']').join(' ');
      result.push(chordPrefix + ' ' + line);
      i++; // 次の行をスキップ
    } else {
      result.push(lines[i]);
    }
  }
  return result.join('\n');
}

function isBareChordOnlyLine(line) {
  if (!line || line.startsWith('[') || line.startsWith('title:') || line.startsWith('key:') || line.startsWith('capo:')) return false;
  // スペース区切りのコード名のみで構成されているか
  const tokens = line.trim().split(/\s+/);
  return tokens.length > 0 && tokens.every(t => /^[A-G][b#]?(m|maj|min|dim|aug|sus|add|M)?[0-9]?(\/[A-G][b#]?)?$/.test(t));
}

function isMetaLine(line) {
  return /^(title:|key:|capo:|duration:|vocal:|\[)/.test(line.trim());
}
