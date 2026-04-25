// もてログ980 - Netlify Function v2
// 口コミ文生成 + AI返信文生成 + NGワード対応 + MEOキーワード反映

const NOTION_TOKEN    = process.env.NOTION_TOKEN;
const DIFY_API_KEY    = process.env.MOTELOG980_DIFY_KEY;
const NOTION_980_SETTINGS_DB = process.env.NOTION_980_SETTINGS_DB;

async function getShopSettings(placeId) {
  if (!NOTION_980_SETTINGS_DB || !placeId) return null;
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_980_SETTINGS_DB}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        filter: { property: 'Place ID', rich_text: { equals: placeId } },
        page_size: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    const props = data.results[0].properties;
    return {
      location: props['場所']?.rich_text?.[0]?.text?.content || '',
      genre:    props['ジャンル']?.rich_text?.[0]?.text?.content || '',
      kw1:      props['キーワード1']?.rich_text?.[0]?.text?.content || '',
      kw2:      props['キーワード2']?.rich_text?.[0]?.text?.content || '',
      kw3:      props['キーワード3']?.rich_text?.[0]?.text?.content || '',
      ngWords:  props['NGワード']?.rich_text?.[0]?.text?.content || '',
    };
  } catch { return null; }
}

async function saveToNotion(dbId, data) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties: {
        '来店日時':       { title:     [{ text: { content: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) } }] },
        '接客★':         { number:    Number(data.service) },
        '雰囲気★':       { number:    Number(data.atmosphere) },
        'テンション':     { rich_text: [{ text: { content: data.moment      || '' } }] },
        '次回同伴':       { rich_text: [{ text: { content: data.nextVisit   || '' } }] },
        'お客様コメント': { rich_text: [{ text: { content: data.shopComment || '' } }] },
        'Place ID':      { rich_text: [{ text: { content: data.placeId     || '' } }] },
        'AI返信文':      { rich_text: [{ text: { content: data.replyText  || '' } }] },
      },
    }),
  });
  if (!res.ok) throw new Error(`Notion error: ${await res.text()}`);
  return res.json();
}

async function callDify(prompt) {
  const res = await fetch('https://api.dify.ai/v1/chat-messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: {}, query: prompt, response_mode: 'blocking',
      conversation_id: '', user: 'motelog980',
    }),
  });
  if (!res.ok) { console.error('Dify error:', await res.text()); return null; }
  const json = await res.json();
  return (json.answer || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() || null;
}

async function generateReview(data, settings) {
  const stars = (n) => '★'.repeat(Number(n)) + '☆'.repeat(5 - Number(n));
  const meoBlock = settings
    ? `\n【MEOキーワード（自然に含めること）】\n場所: ${settings.location}\nジャンル: ${settings.genre}\nキーワード: ${[settings.kw1, settings.kw2, settings.kw3].filter(Boolean).join('・')}`
    : '';
  const ngBlock = settings?.ngWords ? `\n【NGワード（絶対に使わない）】\n${settings.ngWords}` : '';

  return callDify(`あなたは飲食店の来店客として、自然なGoogleレビューを書いてください。

【店舗名】${data.shopName}
【お客様の評価】
接客: ${stars(data.service)}（${data.service}/5）
雰囲気: ${stars(data.atmosphere)}（${data.atmosphere}/5）
テンションが上がった瞬間: ${data.moment || 'とくになし'}
次回一緒に来たい人: ${data.nextVisit || '未回答'}
${meoBlock}${ngBlock}

【条件】
・入力された情報だけを使う（入力にない料理名・描写は書かない）
・100〜130字程度・です・ます調・日本語のみ・絵文字1〜2個
・思考過程は出力しない

口コミ文のみ出力してください。`);
}

async function generateReply(data, reviewText, settings) {
  return callDify(`あなたは飲食店のオーナーとして、Googleの口コミへの返信文を書いてください。

【店舗名】${data.shopName}
【お客様の口コミ文】
${reviewText}

【条件】
・「${data.shopName}をご利用いただきありがとうございます」から始める
・80〜120字程度・丁寧で温かみのある口調・再来店を自然に促す
・日本語のみ・思考過程は出力しない
${settings?.location ? `・「${settings.location}」の地名を自然に入れる` : ''}

返信文のみ出力してください。`);
}

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  if (!data.service || !data.atmosphere) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '必須項目が不足しています' }) };
  }

  try {
    const settings = await getShopSettings(data.placeId);
    console.log('[980] 店舗設定:', settings ? '取得済み' : 'なし');

    const dbId = data.notionDbId || process.env.NOTION_980_DB_ID;
    const pageRes = dbId ? await saveToNotion(dbId, data) : null;
if (pageRes) console.log('[980] Notion保存完了');

    const reviewText = await generateReview(data, settings);
    console.log('[980] 口コミ文生成完了');

    const replyText = reviewText ? await generateReply(data, reviewText, settings) : null;
    console.log('[980] 返信文生成完了');
if (pageRes && replyText) {
      await fetch(`https://api.notion.com/v1/pages/${pageRes.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          properties: {
            'AI返信文': { rich_text: [{ text: { content: replyText } }] },
          },
        }),
      });
      console.log('[980] AI返信文をNotionに書き戻し完了');
    }
    const googleUrl = data.placeId
      ? `https://search.google.com/local/writereview?placeid=${data.placeId}&hl=ja`
      : null;

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, reviewText, googleUrl }),
    };
  } catch (err) {
    console.error('[980] Error:', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
