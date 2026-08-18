# DayPlan real notifications — setup

Roughly 30 minutes. Everything below is free.

## Why this is needed

The old system ran a `setInterval` inside the page. Android freezes and then kills
that process seconds after you leave the app, so no reminder ever fired. Web Push
works the other way round: a server sends the message, Android's own push service
wakes the service worker, and the notification appears with the app fully closed.

---

## 1. Generate your VAPID keys

In a Codespace terminal on the DayPlan repo:

```bash
npx web-push generate-vapid-keys
```

You get a public key and a private key. Keep the private one secret — never put it
in `index.html` or commit it.

## 2. Create the Redis store

The server needs somewhere to remember your subscription and your reminder times.

1. Vercel dashboard → your DayPlan project → **Storage** → **Create Database**
2. Choose **Upstash Redis** (free tier) → connect it to the project
3. Vercel injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   automatically. Nothing to copy.

## 3. Add environment variables

Vercel → Settings → **Environment Variables**. Add four:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | public key from step 1 |
| `VAPID_PRIVATE_KEY` | private key from step 1 |
| `VAPID_SUBJECT` | `mailto:your@email.com` |
| `CRON_SECRET` | any long random string you invent |

## 4. Add the files to the repo

Commit these at the repo root:

```
sw.js               (replaces your current one — cache bumped to dayplan-v3)
push-client.js      (new)
api/subscribe.js    (new)
api/send.js         (new)
package.json        (new, or add "web-push" to your existing one)
```

## 5. Two small edits

**In `push-client.js`**, line 5: paste your VAPID **public** key.

**In `index.html`**, just before `</body>`:

```html
<script src="push-client.js"></script>
```

That is the only change to `index.html`. The script reads your reminders directly
out of `localStorage['dp_v4']`, so none of your existing notification code needs
touching. The in-app Win98 popups keep working exactly as before when the app is
open.

## 6. Set up the clock

Vercel's Hobby plan only allows one cron run per day, which is useless here, so use
a free external pinger.

1. Go to **cron-job.org** and create an account
2. New cron job:
   - URL: `https://dayplan.naalstepanova.com/api/send?key=YOUR_CRON_SECRET`
   - Schedule: every 5 minutes
3. Save and enable

If you ever move to Vercel Pro, you can drop cron-job.org and add a `vercel.json`
with `"crons": [{ "path": "/api/send", "schedule": "*/5 * * * *" }]` instead.

## 7. Test it

1. Commit and push, wait for Vercel to deploy
2. On your phone, **fully close DayPlan and reopen it** (the service worker needs
   to update to v3)
3. Open the notifications tab, confirm it still says notifications are ON
4. In a desktop browser, open the app, then check the console for
   `[push] schedule synced`
5. Set a test reminder for 5 minutes from now
6. Swipe DayPlan away completely
7. Wait

To check the server side, open in a browser:
`https://dayplan.naalstepanova.com/api/send?key=YOUR_CRON_SECRET`

It returns JSON showing the local time it computed, how many reminders it checked,
and which it sent. That is the fastest way to spot a problem.

---

## Notes

- **5-minute granularity.** A reminder set for 21:00 arrives somewhere between
  21:00 and 21:05. Fine for habit nudges. Set the cron to every minute if you want
  exact timing, but that is 43,200 pings a month, above most free tiers.
- **Timezone** is taken from your phone and stored per subscription, so it follows
  you when you travel. It falls back to Europe/Luxembourg.
- **One device.** Everything is stored under the single Redis key `dayplan:user`,
  so the most recent device to sync wins. If you want reminders on both phone and
  laptop, that needs a per-endpoint list instead. Easy to extend later.
- **Battery optimisation.** Android may still delay a push by a few minutes if the
  phone is in deep sleep. To make DayPlan exempt: Settings → Apps → DayPlan →
  Battery → Unrestricted.
- **Duplicates.** The `fired` map in Redis prevents the same reminder firing twice
  in one day. Your old client-side `notif_last_*` localStorage guard still stops
  the in-app popup from repeating, so the two do not collide.
