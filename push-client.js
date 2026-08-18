/* DayPlan push client
   Reads your reminders straight out of localStorage and syncs them to the
   server, so nothing inside index.html needs to change. */

const VAPID_PUBLIC_KEY = 'PASTE_YOUR_PUBLIC_KEY_HERE';
const STATE_KEY = 'dp_v4';          // localStorage key your app already uses
const SYNC_EVERY_MS = 5 * 60 * 1000;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function readNotifs() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return [];
    const state = JSON.parse(raw);
    const list = state && state.notifs ? state.notifs : [];
    return list
      .filter(n => n && n.on && n.time && n.msg)
      .map(n => ({
        id: String(n.id),
        msg: n.msg,
        time: n.time,
        emoji: n.emoji || '',
        repeat: n.repeat || 'daily'
      }));
  } catch (err) {
    return [];
  }
}

let lastPayload = '';

async function syncPushSchedule(force) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const body = JSON.stringify({
      subscription: sub,
      notifs: readNotifs(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Luxembourg'
    });

    if (!force && body === lastPayload) return;

    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (res.ok) {
      lastPayload = body;
      console.log('[push] schedule synced');
    } else {
      console.warn('[push] sync failed', res.status);
    }
  } catch (err) {
    console.warn('[push] error', err);
  }
}

/* run on load, when the app comes back to the foreground, and periodically */
window.addEventListener('load', () => syncPushSchedule(true));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncPushSchedule(false);
});
setInterval(() => syncPushSchedule(false), SYNC_EVERY_MS);

/* expose for manual use / debugging from the console */
window.syncPushSchedule = syncPushSchedule;
