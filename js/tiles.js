// Builds a single shortcut tile. Shared by custom categories and "Recently used".

import { cachedIcon, resolveIcon, forgetIcon } from "./icons.js";
import { watchStatus } from "./status.js";

/** A crisp, perfectly centred ✕ (a text "×" sits off-centre because of font metrics). */
export const CLOSE_ICON =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

/** A readable name for a site: news.ycombinator.com -> Ycombinator, bbc.co.uk -> Bbc. Accepts a URL or hostname. */
export function siteName(urlOrHost) {
  const host = hostOf(urlOrHost) || urlOrHost;
  const parts = host.split(".");
  let i = parts.length - 2;
  if (i > 0 && parts[parts.length - 1].length === 2 && /^(co|com|org|net|ac|gov|edu)$/.test(parts[i])) i--;
  const main = parts[Math.max(i, 0)] || host;
  return main.charAt(0).toUpperCase() + main.slice(1);
}

/** Shortens a page title to a tile name: "GitHub · Build and ship software" -> "GitHub". */
export function cleanTitle(title) {
  // Split at " - ", " | ", " · ", " – ", " — " or ": " ("Regex101: build and test regex" -> "Regex101")
  return title.split(/\s+[-|·–—]\s+|:\s+/)[0].trim().slice(0, 24);
}

/**
 * @param {{name: string, url: string, icon?: string}} s
 * @param {{onRemove?: () => void, monitor?: boolean}} [opts]
 */
export function makeTile(s, opts = {}) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = s.url;
  a.title = s.url;
  a.draggable = false;

  const letter = document.createElement("div");
  letter.className = "letter";
  letter.textContent = (s.name[0] || "?").toUpperCase();

  const host = hostOf(s.url);
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = s.name;

  // Show the letter until the best icon is found (instant if it's cached)
  const cached = cachedIcon(s, host);
  if (cached) {
    img.src = cached;
    img.onerror = () => {
      img.replaceWith(letter);
      if (!s.icon) forgetIcon(host); // stale cache entry — look again next time
    };
    a.append(img, label);
  } else {
    a.append(letter, label);
    resolveIcon(s, host).then((src) => {
      if (!src) return;
      img.src = src;
      img.onload = () => letter.replaceWith(img);
    });
  }

  if (opts.monitor) {
    const dot = document.createElement("span");
    dot.className = "status-dot";
    a.append(dot);
    watchStatus(dot, s.url);
  }

  if (opts.onRemove) {
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.innerHTML = CLOSE_ICON;
    remove.title = "Remove";
    remove.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't also open the edit dialog
      opts.onRemove();
    });
    a.append(remove);
  }

  return a;
}
