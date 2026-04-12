const STRIPE_SECRET   = process.env.STRIPE_980_SECRET_KEY;
const STRIPE_PRICE_ID = process.env.STRIPE_980_PRICE_ID;
const BASE_URL        = 'https://motelog980.netlify.app';

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let data;
  try { data = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { shopName, location, genre, kw1, kw2, kw3, placeId, email } = data;
  if (!shopName || !email) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '店舗名とメールは必須です' }) };
  }

  try {
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      customer_email: email,
      success_url: `${BASE_URL}/thanks.html?shop=${encodeURIComponent(shopName)}`,
      cancel_url: `${BASE_URL}/apply.html`,
      'metadata[shop_name]': shopName,
      'metadata[location]':  location || '',
      'metadata[genre]':     genre    || '',
      'metadata[kw1]':       kw1      || '',
      'metadata[kw2]':       kw2      || '',
      'metadata[kw3]':       kw3      || '',
      'metadata[place_id]':  placeId  || '',
      'metadata[agreed_at]':  body.agreedAt || '',
      'metadata[email]':     email,
      'subscription_data[trial_period_days]': '7',
    });

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) throw new Error(await res.text());
    const session = await res.json();

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('[980] Stripe error:', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
