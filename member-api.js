// もてログ980 - 会員証データ取得API
// Railway（thelog-keeper）に追加するエンドポイント
// GET /api/980/member?uid=LINE_USER_ID または ?mid=MTLG-XXXXXX

const NOTION_TOKEN     = process.env.NOTION_TOKEN;
const NOTION_MEMBER_DB = process.env.NOTION_MEMBER_DB_ID;

async function getMemberByUid(lineUid) {
  const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_MEMBER_DB}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      filter: { property: 'LINE User ID', rich_text: { equals: lineUid } },
      page_size: 1,
    }),
  });
  const data = await res.json();
  return data.results?.[0] || null;
}

async function getMemberByMid(memberId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_MEMBER_DB}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      filter: { property: '会員番号', title: { equals: memberId } },
      page_size: 1,
    }),
  });
  const data = await res.json();
  return data.results?.[0] || null;
}

function parseHistory(raw) {
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(line => {
    const [date, shopName] = line.split('|');
    return { date: date?.trim(), shopName: shopName?.trim() };
  }).filter(h => h.date && h.shopName);
}

// Express Router に追加する形式
// app.get('/api/980/member', memberHandler);
export async function memberHandler(req, res) {
  const { uid, mid } = req.query;

  if (!uid && !mid) {
    return res.status(400).json({ success: false, error: 'uid または mid が必要です' });
  }

  try {
    const page = uid ? await getMemberByUid(uid) : await getMemberByMid(mid);

    if (!page) {
      return res.status(404).json({ success: false, error: '会員が見つかりません' });
    }

    const props = page.properties;
    const historyRaw = props['来店履歴']?.rich_text?.[0]?.text?.content || '';

    const member = {
      memberId:     props['会員番号']?.title?.[0]?.text?.content || '',
      shopName:     props['登録店舗']?.rich_text?.[0]?.text?.content || 'もてログ980',
      registeredAt: props['登録日']?.rich_text?.[0]?.text?.content || '',
      visitCount:   props['累計来店数']?.number || 0,
      shopCount:    props['利用店舗数']?.number || 1,
      history:      parseHistory(historyRaw),
    };

    return res.json({ success: true, member });
  } catch(e) {
    console.error('[member-api] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}

// ── 来店カウント更新（submit.js から呼び出す） ──────────
// POST /api/980/member/checkin
export async function checkinHandler(req, res) {
  const { lineUid, memberId, shopName, placeId } = req.body;

  if (!lineUid && !memberId) {
    return res.status(400).json({ success: false, error: 'lineUid または memberId が必要です' });
  }

  try {
    const page = lineUid
      ? await getMemberByUid(lineUid)
      : await getMemberByMid(memberId);

    if (!page) {
      return res.status(404).json({ success: false, error: '会員が見つかりません' });
    }

    const props = page.properties;
    const currentCount = props['累計来店数']?.number || 0;
    const historyRaw   = props['来店履歴']?.rich_text?.[0]?.text?.content || '';
    const today = new Date().toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit'
    });

    // 履歴に追記（新しい順・最大50件）
    const newHistory = [`${today}|${shopName || '不明'}`, ...historyRaw.split('\n').filter(Boolean)]
      .slice(0, 50).join('\n');

    // 利用店舗数（ユニーク店舗数を計算）
    const shops = new Set(newHistory.split('\n').map(l => l.split('|')[1]?.trim()).filter(Boolean));

    await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        properties: {
          '累計来店数': { number: currentCount + 1 },
          '来店履歴':   { rich_text: [{ text: { content: newHistory } }] },
          '利用店舗数': { number: shops.size },
          '最終来店日': { rich_text: [{ text: { content: today } }] },
        },
      }),
    });

    return res.json({ success: true, visitCount: currentCount + 1 });
  } catch(e) {
    console.error('[checkin] Error:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
}
