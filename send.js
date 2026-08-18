import webpush from 'web-push';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

/* how wide a window counts as "due" — must be >= your cron interval */
const WINDOW_MINUTES = 6;

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

/* current wall-clock time in a given IANA timezone */
function localNow(tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false
  }).formatToParts(new Date());

  const get = t => parts.find(p => p.type === t).value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
    dow: weekdayMap[get('weekday')]
  };
}

function matchesRepeat(repeat, dow) {
  const isWeekday = dow >= 1 && dow <= 5;
  if (repeat === 'weekdays') return isWeekday;
  if (repeat === 'weekends') return !isWeekday;
  return true;
}

export default async function handler(req, res) {
  const key = req.query.key || req.headers['x-cron-key'];
  const auth = req.headers.authorization;
  const authorized =
    (CRON_SECRET && key === CRON_SECRET) ||
    (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`);

  if (!authorized) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:you@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const rawUser = await redis('GET', 'dayplan:user');
    if (!rawUser) {
      res.status(200).json({ ok: true, note: 'no subscription stored yet' });
      return;
    }

    const user = JSON.parse(rawUser);
    const tz = user.tz || 'Europe/Luxembourg';
    const now = localNow(tz);

    const rawFired = await redis('GET', 'dayplan:fired');
    const fired = rawFired ? JSON.parse(rawFired) : {};

    const due = [];
    for (const n of user.notifs || []) {
      const [hh, mm] = String(n.time).split(':').map(Number);
      if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
      const target = hh * 60 + mm;
      const delta = now.minutes - target;

      if (delta < 0 || delta >= WINDOW_MINUTES) continue;
      if (!matchesRepeat(n.repeat, now.dow)) continue;
      if (fired[n.id] === now.date) continue;

      due.push(n);
    }

    const sent = [];
    const failed = [];

    for (const n of due) {
      const payload = JSON.stringify({
        title: n.emoji ? `${n.emoji} DayPlan` : 'DayPlan \u2661',
        body: n.msg,
        tag: `dayplan-${n.id}`,
        url: '/'
      });

      try {
        await webpush.sendNotification(user.subscription, payload, { TTL: 3600 });
        fired[n.id] = now.date;
        sent.push(n.id);
      } catch (err) {
        failed.push({ id: n.id, status: err.statusCode });
        /* subscription is dead — drop it so the client re-subscribes */
        if (err.statusCode === 404 || err.statusCode === 410) {
          await redis('DEL', 'dayplan:user');
        }
      }
    }

    if (sent.length) await redis('SET', 'dayplan:fired', JSON.stringify(fired));

    res.status(200).json({
      ok: true,
      localTime: `${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(
        now.minutes % 60
      ).padStart(2, '0')}`,
      tz,
      checked: (user.notifs || []).length,
      sent,
      failed
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
