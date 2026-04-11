const NOTION_TOKEN           = process.env.NOTION_TOKEN;
const STRIPE_WEBHOOK_SECRET  = process.env.STRIPE_980_WEBHOOK_SECRET;
const NOTION_980_SETTINGS_DB = process.env.NOTION_980_SETTINGS_DB;
const BASE_URL               = 'https://motelog980.netlify.app';
const RESEND_API_KEY         = process.env.RESEND_API_KEY;
const FROM_EMAIL             = 'もてログ980 <onboarding@resend.dev>';
const ADMIN_EMAIL            = 'masayuki.tsumoto@gmail.com';

async function verifyStripeSignature(body, signature, secret) {
  const encoder = new TextEncoder();
  const parts = signature.split(',');
  const timestamp = parts.find(p => p.startsWith('t=')).slice(2);
  const v1 = parts.find(p => p.startsWith('v1=')).slice(3);
  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === v1;
}

async function addShopToSettingsDB(shopData) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_980_SETTINGS_DB },
      properties: {
        '店舗名':       { title:     [{ text: { content: shopData.shopName } }] },
        '場所':         { rich_text: [{ text: { content: shopData.location } }] },
        'ジャンル':     { rich_text: [{ text: { content: shopData.genre } }] },
        'キーワード1':  { rich_text: [{ text: { content: shopData.kw1 } }] },
        'キーワード2':  { rich_text: [{ text: { content: shopData.kw2 } }] },
        'キーワード3':  { rich_text: [{ text: { content: shopData.kw3 } }] },
        'Place ID':    { rich_text: [{ text: { content: shopData.placeId } }] },
        'メール':       { email:     shopData.email },
        'Stripe顧客ID': { rich_text: [{ text: { content: shopData.customerId } }] },
        '登録日':       { date:      { start: new Date().toISOString().split('T')[0] } },
        'ステータス':   { select:    { name: '有効' } },
      },
    }),
  });
  if (!res.ok) throw new Error(`店舗設定DB追加エラー: ${await res.text()}`);
  return res.json();
}

async function createReviewDB(shopName) {
  const res = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { type: 'database_id', database_id: NOTION_980_SETTINGS_DB },
      title: [{ type: 'text', text: { content: `${shopName} 口コミDB` } }],
      properties: {
        '来店日時':       { title: {} },
        '接客★':         { number: { format: 'number' } },
        '雰囲気★':       { number: { format: 'number' } },
        'テンション':     { rich_text: {} },
        '次回同伴':       { rich_text: {} },
        'お客様コメント': { rich_text: {} },
        'Place ID':      { rich_text: {} },
      },
    }),
  });
  if (!res.ok) throw new Error(`口コミDB作成エラー: ${await res.text()}`);
  return (await res.json()).id;
}

async function updateSettingsWithReviewDbId(pageId, reviewDbId) {
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      properties: {
        '口コミDB_ID': { rich_text: [{ text: { content: reviewDbId } }] },
      },
    }),
  });
}

async function sendWelcomeEmail(shopData, reviewDbId) {
  const surveyUrl = `${BASE_URL}/?mode=survey&shop=${encodeURIComponent(shopData.shopName)}&place=${shopData.placeId}&db=${reviewDbId}&discount=10`;
  const photoUrl  = `${BASE_URL}/?mode=photo&shop=${encodeURIComponent(shopData.shopName)}&place=${shopData.placeId}&discount=10`;

  const html = `
<!DOCTYPE html>
<html lang="ja">
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
  <div style="background:#1D3D2F;padding:24px;border-radius:12px;text-align:center;margin-bottom:24px;">
    <h1 style="color:#C9A84C;margin:0;font-size:28px;">もてログ980</h1>
    <p style="color:#9FE1CB;margin:8px 0 0;">ご利用開始のご案内</p>
  </div>

  <p>${shopData.shopName} オーナー様</p>
  <p>もてログ980へのご登録ありがとうございます！<br>セットアップが完了しました。以下の2つのQRコードURLをご利用ください。</p>

  <div style="background:#EAF4EE;border-radius:12px;padding:20px;margin:20px 0;">
    <h2 style="color:#1D3D2F;margin:0 0 16px;">📷 写真用QR（テーブルに設置）</h2>
    <p style="font-size:12px;color:#888;margin:0 0 8px;">料理提供時にお客様に写真を撮ってもらうためのQRです</p>
    <a href="${photoUrl}" style="color:#1D3D2F;word-break:break-all;">${photoUrl}</a>
  </div>

  <div style="background:#EAF4EE;border-radius:12px;padding:20px;margin:20px 0;">
    <h2 style="color:#1D3D2F;margin:0 0 16px;">📝 アンケート用QR（レジ横に設置）</h2>
    <p style="font-size:12px;color:#888;margin:0 0 8px;">お会計時にアンケートに回答してもらうためのQRです</p>
    <a href="${surveyUrl}" style="color:#1D3D2F;word-break:break-all;">${surveyUrl}</a>
  </div>

  <div style="background:#FBF5E6;border:1px solid #C9A84C;border-radius:12px;padding:20px;margin:20px 0;">
    <h3 style="color:#8B6914;margin:0 0 12px;">QRコードの作り方</h3>
    <ol style="color:#8B6914;margin:0;padding-left:20px;">
      <li>上記URLをコピー</li>
      <li><a href="https://qr.quel.jp/" style="color:#8B6914;">qr.quel.jp</a> にアクセス</li>
      <li>URLを貼り付けてQRコードを生成</li>
      <li>印刷してテーブル・レジ横に設置</li>
    </ol>
  </div>

  <p style="color:#888;font-size:13px;">ご不明な点はこちらへ：<a href="mailto:masayuki.tsumoto@gmail.com" style="color:#1D3D2F;">masayuki.tsumoto@gmail.com</a></p>

  <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #E8E4DE;">
    <p style="color:#888;font-size:12px;">Powered by もてログ980 | <a href="${BASE_URL}" style="color:#1D3D2F;">motelog980.netlify.app</a></p>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [shopData.email],
      bcc: [ADMIN_EMAIL],
      subject: `【もてログ980】ご利用開始のご案内 - ${shopData.shopName}`,
      html,
    }),
  });

  if (!res.ok) {
    console.error('[980] メール送付エラー:', await res.text());
    return null;
  }
  console.log('[980] ウェルカムメール送付完了:', shopData.email);
  return { surveyUrl, photoUrl };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const signature = event.headers['stripe-signature'];
  try {
    const valid = await verifyStripeSignature(event.body, signature, STRIPE_WEBHOOK_SECRET);
    if (!valid) return { statusCode: 400, body: 'Invalid signature' };
  } catch (e) {
    return { statusCode: 400, body: `Signature error: ${e.message}` };
  }

  const stripeEvent = JSON.parse(event.body);
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored' };
  }

  const session = stripeEvent.data.object;
  const meta = session.metadata || {};
  const shopData = {
    shopName:   meta.shop_name || '未設定',
    location:   meta.location  || '',
    genre:      meta.genre     || '',
    kw1:        meta.kw1       || '',
    kw2:        meta.kw2       || '',
    kw3:        meta.kw3       || '',
    placeId:    meta.place_id  || '',
    email:      session.customer_details?.email || meta.email || '',
    customerId: session.customer || '',
  };

  try {
    console.log('[980] オンボーディング開始:', shopData.shopName);
    const settingsPage = await addShopToSettingsDB(shopData);
    const reviewDbId   = await createReviewDB(shopData.shopName);
    await updateSettingsWithReviewDbId(settingsPage.id, reviewDbId);

    const surveyUrl = `${BASE_URL}/?mode=survey&shop=${encodeURIComponent(shopData.shopName)}&place=${shopData.placeId}&db=${reviewDbId}`;
    const photoUrl  = `${BASE_URL}/?mode=photo&shop=${encodeURIComponent(shopData.shopName)}&place=${shopData.placeId}`;

    console.log('[980] 完了 Survey URL:', surveyUrl);
    console.log('[980] 完了 Photo URL:', photoUrl);

    // ⑤ ウェルカムメール自動送付
    await sendWelcomeEmail(shopData, reviewDbId);

    return { statusCode: 200, body: JSON.stringify({ success: true, surveyUrl, photoUrl }) };
  } catch (err) {
    console.error('[980] セットアップエラー:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
