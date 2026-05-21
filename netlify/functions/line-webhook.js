// もてログ980 - LINE Webhook Handler
// 友だち追加 → 会員番号発行 → Notion保存 → ウェルカムメッセージ送信

const LINE_CHANNEL_SECRET  = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_TOKEN   = process.env.LINE_CHANNEL_TOKEN;
const NOTION_TOKEN         = process.env.NOTION_TOKEN;
const NOTION_MEMBER_DB     = process.env.NOTION_MEMBER_DB_ID;  // 会員マスタDB
const BASE_URL             = process.env.BASE_URL || 'https://motelog980.netlify.app';

// ── 会員番号生成 ──────────────────────────────────────
function generateMemberId() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const ymd = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `MTLG-${ymd}-${suffix}`;
}

// ── LINE署名検証 ──────────────────────────────────────
async function verifySignature(body, signature) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(LINE_CHANNEL_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

// ── Notionで既存会員を検索 ───────────────────────────
async function findMember(lineUid) {
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
  if (!data.results?.length) return null;
  const props = data.results[0].properties;
  return {
    memberId:   props['会員番号']?.rich_text?.[0]?.text?.content || '',
    shopName:   props['登録店舗']?.rich_text?.[0]?.text?.content || 'もてログ980',
    visitCount: props['累計来店数']?.number || 0,
  };
}

// ── Notionに新規会員を保存 ───────────────────────────
async function saveMember(lineUid, memberId, displayName) {
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_MEMBER_DB },
      properties: {
        '会員番号':     { title:     [{ text: { content: memberId } }] },
        'LINE User ID': { rich_text: [{ text: { content: lineUid } }] },
        '表示名':       { rich_text: [{ text: { content: displayName || '' } }] },
        '登録日':       { rich_text: [{ text: { content: now } }] },
        '登録店舗':     { rich_text: [{ text: { content: 'もてログ980' } }] },
        '累計来店数':   { number: 0 },
        '来店履歴':     { rich_text: [{ text: { content: '' } }] },
      },
    }),
  });
  if (!res.ok) throw new Error(`Notion save error: ${await res.text()}`);
  return res.json();
}

// ── LINEメッセージ送信 ───────────────────────────────
async function replyMessage(replyToken, messages) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LINE_CHANNEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

async function pushMessage(lineUid, messages) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LINE_CHANNEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to: lineUid, messages }),
  });
}

// ── 友だち追加イベント処理 ───────────────────────────
async function handleFollow(event) {
  const lineUid = event.source.userId;

  // 既存会員チェック
  let member = await findMember(lineUid);
  let isNew = false;

  if (!member) {
    // 新規発行
    const memberId = generateMemberId();
    await saveMember(lineUid, memberId, '');
    member = { memberId, shopName: 'もてログ980', visitCount: 0 };
    isNew = true;
  }

  const memberUrl = `${BASE_URL}/member?uid=${lineUid}`;

  const messages = [
    {
      type: 'text',
      text: isNew
        ? `🎫 もてログ会員証へようこそ！\n\nあなたの会員番号：\n${member.memberId}\n\n全国のもてログ加盟店で使えます。下のボタンから会員証を確認してください。`
        : `おかえりなさい！\n\nあなたの会員番号：\n${member.memberId}\n\n累計来店：${member.visitCount}回`,
    },
    {
      type: 'template',
      altText: '会員証を確認する',
      template: {
        type: 'buttons',
        text: '会員証を表示します',
        actions: [
          {
            type: 'uri',
            label: '🎫 会員証を見る',
            uri: memberUrl,
          },
          {
            type: 'uri',
            label: '🏪 加盟店一覧',
            uri: 'https://masayukitsumoto-cloud.github.io/motelog980/shops.html',
          },
        ],
      },
    },
  ];

  await replyMessage(event.replyToken, messages);
}


// ── メッセージイベント処理 ───────────────────────────
async function handleMessage(event) {
  const lineUid = event.source.userId;
  const text = (event.message?.text || '').trim();
  const triggers = ['会員証', 'かいいんしょう', 'member', 'MEMBER', '会員', 'カード'];

  if (!triggers.includes(text)) return;

  const member = await findMember(lineUid);
  const memberUrl = `${BASE_URL}/member?uid=${lineUid}`;

  if (!member) {
    await replyMessage(event.replyToken, [{
      type: 'text',
      text: '会員証がまだ発行されていません。\n\nもてログ980の加盟店でアンケートに答えると\n会員証が発行されます 🎫'
    }]);
    return;
  }

  await replyMessage(event.replyToken, [
    {
      type: 'text',
      text: `🎫 ${member.memberId}\n\n累計来店：${member.visitCount || 0}回\n\n下のボタンから会員証を確認してください。`
    },
    {
      type: 'template',
      altText: '会員証を確認する',
      template: {
        type: 'buttons',
        text: '会員証を表示します',
        actions: [
          { type: 'uri', label: '🎫 会員証を見る', uri: memberUrl },
          { type: 'uri', label: '🏪 加盟店一覧', uri: 'https://masayukitsumoto-cloud.github.io/motelog980/shops.html' }
        ]
      }
    }
  ]);
}

// ── メインハンドラ ────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const signature = event.headers['x-line-signature'];
  const body = event.body;

  // 署名検証
  if (LINE_CHANNEL_SECRET) {
    const valid = await verifySignature(body, signature);
    if (!valid) {
      console.error('[LINE] 署名検証失敗');
      return { statusCode: 401, body: 'Unauthorized' };
    }
  }

  let payload;
  try { payload = JSON.parse(body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  // イベント処理
  for (const ev of payload.events || []) {
    try {
      if (ev.type === 'follow') {
        await handleFollow(ev);
        console.log('[LINE] 友だち追加処理完了:', ev.source.userId);
      } else if (ev.type === 'message' && ev.message?.type === 'text') {
        await handleMessage(ev);
        console.log('[LINE] メッセージ処理完了:', ev.source.userId);
      }
    } catch(e) {
      console.error('[LINE] イベント処理エラー:', e.message);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
