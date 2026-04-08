const NOTION_TOKEN    = process.env.NOTION_TOKEN;
const NOTION_980_DB_ID = process.env.NOTION_980_DB_ID;
const DIFY_API_KEY    = process.env.MOTELOG980_DIFY_KEY;
const DISCORD_WEBHOOK = process.env.MOTELOG980_DISCORD_WEBHOOK;

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
        '来店日時':     { title:     [{ text: { content: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) } }] },
        '接客★':       { number:    Number(data.service) },
        '雰囲気★':     { number:    Number(data.atmosphere) },
        'テンション':   { rich_text: [{ text: { content: data.moment     || '' } }] },
        '次回同伴':     { rich_text: [{ text: { content: data.nextVisit  || '' } }] },
        'お客様コメント': { rich_text: [{ text: { content: data.shopComment || '' } }] },
        'Place ID':    { rich_text: [{ text: { content: data.placeId    || '' } }] },
      },
    }),
  });
  if (!res.ok) throw new Error(`Notion error: ${await res.text()}`);
  return res.json();
}

async function generateReview(data) {
  const prompt = `あなたは飲食店の来店客として、自然なGoogleレビューを書いてください。

【店舗情報】
店舗名: ${data.shopName}

【お客様の評価】
接客: ${'★'.repeat(Number(data.service))}${'☆'.repeat(5-Number(data.service))}
雰囲気: ${'★'.repeat(Number(data.atmosphere))}${'☆'.repeat(5-Number(data.atmosphere))}
テンションが上がった瞬間: ${data.moment || 'とくになし'}
次回は誰と: ${data.nextVisit || '未回答'}

【条件】
・100〜150字程度
・です・ます調
・具体的な表現で
・絵文字を1〜2個使う

口コミ文のみ出力してください。`;

  const res = await fetch('https://api.dify.ai/v1/chat-messages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DIFY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: {}, query: prompt, response_mode: 'blocking', conversation_id: '', user: 'motelog980' }),
  });
  if (!res.ok) { console.error('Dify error:', await res.text()); return null; }
  const answer = (await res.json()).answer || '';
  // <think>...</think>タグを除去
  const cleaned = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return cleaned || null;
}

async function notifyDiscord(data, reviewText) { return; // Discord無効化
  const stars = n => '★'.repeat(Number(n)) + '☆'.repeat(5-Number(n));
  const lines = [
    `## 🍽️ 新しい口コミが届きました！【${data.shopName}】`,
    ``,
    `**接客**: ${stars(data.service)}`,
    `**雰囲気**: ${stars(data.atmosphere)}`,
    `**テンション↑**: ${data.moment || '（未記入）'}`,
    `**次回は誰と**: ${data.nextVisit || '（未記入）'}`,
    data.shopComment ? `**💬 お客様コメント**: ${data.shopComment}` : null,
    ``,
    `---`,
    `**📝 AI生成 口コミ文**`,
    `\`\`\``,
    reviewText || '（生成失敗）',
    `\`\`\``,
    `🔗 返信: https://search.google.com/local/writereview?placeid=${data.placeId}`,
  ].filter(l => l !== null).join('\n');

  await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: lines }),
  });
}

export const handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let data;
  try { data = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  if (!data.service || !data.atmosphere) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '必須項目不足' }) };

  try {
    const dbId = data.notionDbId || NOTION_980_DB_ID;
    if (dbId) await saveToNotion(dbId, data);
    const reviewText = await generateReview(data);
    if (DISCORD_WEBHOOK) await notifyDiscord(data, reviewText);

    const googleUrl = data.placeId
      ? `https://search.google.com/local/writereview?placeid=${data.placeId}&hl=ja`
      : null;

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, reviewText, googleUrl }) };
  } catch (err) {
    console.error('[980] Error:', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
