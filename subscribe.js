const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...cmd) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(cmd)
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { subscription, notifs, tz } = body || {};

    if (!subscription || !subscription.endpoint) {
      res.status(400).json({ error: 'missing subscription' });
      return;
    }

    await redis(
      'SET',
      'dayplan:user',
      JSON.stringify({
        subscription,
        notifs: Array.isArray(notifs) ? notifs : [],
        tz: tz || 'Europe/Luxembourg',
        updatedAt: new Date().toISOString()
      })
    );

    res.status(200).json({ ok: true, count: (notifs || []).length });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
