// Online/offline dots for shortcuts marked "Show online status" (e.g. a NAS).
// A site counts as online if it answers any HTTP request within the timeout; the
// response itself is never read (no-cors), so this works for any site without extra permissions.

const CHECK_EVERY = 60 * 1000; // ms between checks while the page is visible
const TIMEOUT = 6000;          // ms before a site counts as offline

const results = new Map(); // url -> { online: boolean, time: number }
const pending = new Map(); // url -> Promise
const dots = new Set();    // { dot, url }
let timer = null;

function paint(dot, result) {
  dot.classList.remove("online", "offline", "checking");
  if (!result) {
    dot.classList.add("checking");
    dot.title = "Checking…";
    return;
  }
  dot.classList.add(result.online ? "online" : "offline");
  const at = new Date(result.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  dot.title = `${result.online ? "Online" : "Not responding"} · checked ${at}`;
}

async function check(url) {
  if (pending.has(url)) return pending.get(url);
  const job = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    let online = false;
    try {
      await fetch(url, { mode: "no-cors", cache: "no-store", credentials: "omit", signal: ctrl.signal });
      online = true;
    } catch {}
    clearTimeout(t);
    results.set(url, { online, time: Date.now() });
    for (const d of dots) if (d.url === url) paint(d.dot, results.get(url));
  })();
  pending.set(url, job);
  try { await job; } finally { pending.delete(url); }
}

function checkAll() {
  // Forget dots whose tiles were redrawn
  for (const d of dots) if (!d.dot.isConnected) dots.delete(d);
  const urls = new Set([...dots].map((d) => d.url));
  urls.forEach(check);
  if (!dots.size) {
    clearInterval(timer);
    timer = null;
  }
}

/** Shows a live status dot for `url` inside `dot`. */
export function watchStatus(dot, url) {
  dots.add({ dot, url });
  const known = results.get(url);
  paint(dot, known);
  if (!known || Date.now() - known.time > CHECK_EVERY) check(url);
  timer ??= setInterval(() => { if (!document.hidden) checkAll(); }, CHECK_EVERY);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && dots.size) checkAll();
});
