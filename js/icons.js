// Finds the best icon for a shortcut. Sources, best first:
//   1. a custom icon set on the shortcut (URL or uploaded image)
//   2. the site's high-res apple-touch-icon (usually 180px)
//   3. Brave's own favicon cache (knows private sites you've visited, e.g. a NAS)
//   4. Google's favicon service (last resort — often small or a generic globe)
// The winner is cached per site so tiles show their icon instantly next time.

const CACHE_KEY = "newtab.iconCache";
const CACHE_DAYS = 7;
const GOOD_SIZE = 64; // px — big enough to look sharp in a 32–40px tile on high-DPI screens

let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch {}

function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

export function forgetIcon(host) {
  delete cache[host];
  saveCache();
}

/** Returns a cached icon URL for this site, if we have a fresh one. */
export function cachedIcon(s, host) {
  if (s.icon) return s.icon;
  const hit = cache[host];
  return hit && Date.now() - hit.t < CACHE_DAYS * 864e5 ? hit.src : null;
}

/** A small icon URL for any page, for lists (Brave's icon cache inside the extension, else Google). */
export function smallIconUrl(pageUrl) {
  const fromBrave = browserFaviconUrl(pageUrl, 32);
  if (fromBrave) return fromBrave;
  try { return `https://www.google.com/s2/favicons?domain=${new URL(pageUrl).hostname}&sz=32`; } catch { return ""; }
}

function browserFaviconUrl(pageUrl, size = 64) {
  if (!globalThis.chrome?.runtime?.getURL) return null; // only inside the extension
  const u = new URL(chrome.runtime.getURL("/_favicon/"));
  u.searchParams.set("pageUrl", pageUrl);
  u.searchParams.set("size", String(size));
  return u.href;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Brave returns a generic globe for sites it has no icon for. Fingerprint it so we can skip it.
function fingerprint(img) {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    c.getContext("2d").drawImage(img, 0, 0, 16, 16);
    return c.toDataURL();
  } catch {
    return null;
  }
}
let defaultFingerprint;
function browserDefaultFingerprint() {
  defaultFingerprint ??= (async () => {
    const src = browserFaviconUrl("https://no-such-site.invalid/");
    const img = src && (await loadImage(src));
    return img ? fingerprint(img) : null;
  })();
  return defaultFingerprint;
}

/** Works out the best icon URL for a shortcut, or null if there is none. */
export async function resolveIcon(s, host) {
  if (s.icon) return s.icon;
  if (!host) return null;

  const candidates = [
    { src: `https://${host}/apple-touch-icon.png` },
    { src: browserFaviconUrl(s.url), browser: true },
    { src: `https://www.google.com/s2/favicons?domain=${host}&sz=128`, lastResort: true },
  ].filter((c) => c.src);

  let best = null;
  let bestSize = 0;
  let usedLastResort = false;
  for (const c of candidates) {
    if (c.lastResort && best) break; // Google only if nothing else worked
    const img = await loadImage(c.src);
    if (!img) continue;
    if (c.browser) {
      const def = await browserDefaultFingerprint();
      if (def && fingerprint(img) === def) continue;
    }
    const size = Math.min(img.naturalWidth, img.naturalHeight);
    if (size > bestSize) {
      best = c.src;
      bestSize = size;
      usedLastResort = !!c.lastResort;
    }
    if (size >= GOOD_SIZE) break;
  }

  if (best) {
    // Keep a Google fallback for only a day, so a better icon is picked up once Brave has one
    const t = usedLastResort ? Date.now() - (CACHE_DAYS - 1) * 864e5 : Date.now();
    cache[host] = { src: best, t };
    saveCache();
  }
  return best;
}

/**
 * Finds the part of the image that isn't empty border: transparent pixels, or
 * (for images without transparency) pixels matching the corner background colour.
 */
function contentBounds(ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const bg = [data[0], data[1], data[2], data[3]];
  const opaqueBg = bg[3] > 250;
  const isBackground = (i) => {
    if (data[i + 3] < 12) return true;
    if (!opaqueBg) return false;
    return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 30;
  };
  let top = h, left = w, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isBackground((y * w + x) * 4)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return { x: 0, y: 0, w, h }; // blank image — keep as is
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * Turns an uploaded image into a compact PNG data URL: trims empty borders,
 * keeps the original shape (wide logos stay wide) and limits the longest side.
 */
export function imageFileToIcon(file, maxSide = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Work on a copy no bigger than 1024px to keep trimming fast
      const s = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const work = document.createElement("canvas");
      work.width = Math.max(1, Math.round(img.naturalWidth * s));
      work.height = Math.max(1, Math.round(img.naturalHeight * s));
      const wctx = work.getContext("2d", { willReadFrequently: true });
      wctx.drawImage(img, 0, 0, work.width, work.height);
      const b = contentBounds(wctx, work.width, work.height);

      const scale = Math.min(1, maxSide / Math.max(b.w, b.h));
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(b.w * scale));
      out.height = Math.max(1, Math.round(b.h * scale));
      const octx = out.getContext("2d");
      octx.imageSmoothingQuality = "high";
      octx.drawImage(work, b.x, b.y, b.w, b.h, 0, 0, out.width, out.height);
      URL.revokeObjectURL(url);
      resolve(out.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't an image Brave can read"));
    };
    img.src = url;
  });
}
