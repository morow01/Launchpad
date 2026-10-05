// "Recently closed" button (next to the cog): lists tabs and windows closed recently
// and reopens one with a click. Uses Brave's own session history (chrome.sessions).

import * as settings from "./settings.js";
import { alertDialog } from "./menu.js";

const MAX_ITEMS = 12;

const btn = document.getElementById("closedBtn");
let menu = null;

const hasSessions = () => !!globalThis.chrome?.sessions?.getRecentlyClosed;

function ago(seconds) {
  const mins = Math.round((Date.now() / 1000 - seconds) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function close() {
  menu?.remove();
  menu = null;
  btn.setAttribute("aria-expanded", "false");
}

function row({ icon, title, sub, onClick }) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "closed-item";
  b.setAttribute("role", "menuitem");

  const img = document.createElement("span");
  img.className = "closed-icon";
  if (icon) img.style.backgroundImage = `url("${icon.replace(/"/g, "%22")}")`;
  else img.textContent = (title[0] || "?").toUpperCase();

  const text = document.createElement("span");
  text.className = "closed-text";
  const t = document.createElement("span");
  t.className = "closed-title";
  t.textContent = title;
  const s = document.createElement("small");
  s.textContent = sub;
  text.append(t, s);

  b.append(img, text);
  b.addEventListener("click", onClick);
  return b;
}

// New tab pages (including this one) aren't worth reopening
const isNewTabPage = (url) =>
  /^(chrome|brave|edge):\/\/(newtab|new-tab-page)/i.test(url) || url.startsWith(location.origin);

async function open() {
  let sessions = [];
  let error = "";
  if (!hasSessions()) {
    error = "Brave didn't give the page access to closed tabs. Reload the extension in brave://extensions.";
  } else {
    try {
      sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
    } catch (err) {
      error = "Couldn't read recently closed tabs: " + err.message;
    }
  }
  menu = document.createElement("div");
  menu.className = "menu closed-menu";
  menu.setAttribute("role", "menu");
  const heading = document.createElement("div");
  heading.className = "menu-heading";
  heading.textContent = "Recently closed";
  menu.append(heading);

  let count = 0;
  for (const s of sessions) {
    if (count >= MAX_ITEMS) break;
    const restore = () => {
      close();
      Promise.resolve(chrome.sessions.restore(s.tab?.sessionId ?? s.window?.sessionId))
        .catch((err) => alertDialog("Couldn't reopen it", err.message));
    };
    if (s.tab) {
      // url/title need the "tabs" permission; show the tab even if Brave leaves them out
      const url = s.tab.url || "";
      if (url && isNewTabPage(url)) continue;
      const host = hostOf(url);
      menu.append(row({
        icon: s.tab.favIconUrl || "",
        title: s.tab.title || host || "Closed tab",
        sub: [host, ago(s.lastModified)].filter(Boolean).join(" · "),
        onClick: restore,
      }));
      count++;
    } else if (s.window) {
      const n = s.window.tabs?.length || 0;
      menu.append(row({
        icon: "",
        title: `Window with ${n} tab${n === 1 ? "" : "s"}`,
        sub: ago(s.lastModified),
        onClick: restore,
      }));
      count++;
    }
  }
  if (!count) {
    const empty = document.createElement("p");
    empty.className = "closed-empty";
    empty.textContent = error || "Nothing closed recently.";
    menu.append(empty);
  }
  const tip = document.createElement("p");
  tip.className = "closed-tip";
  tip.textContent = "Tip: Ctrl+Shift+T reopens the last closed tab anywhere.";
  menu.append(tip);

  document.body.append(menu);
  const r = btn.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = r.bottom + 8 + "px";
  menu.style.right = Math.max(8, innerWidth - r.right) + "px";
  btn.setAttribute("aria-expanded", "true");
  menu.querySelector(".closed-item")?.focus();
}

export function initClosed() {
  // Inside the extension the button always shows (when switched on), so a missing
  // permission shows up as a message in the list rather than a silently missing button
  const inExtension = !!globalThis.chrome?.runtime?.id || hasSessions();
  settings.onChange((s) => { btn.hidden = !s.show.closed || !inExtension; });
  btn.addEventListener("click", () => (menu ? close() : open()));
  document.addEventListener("pointerdown", (e) => {
    if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("resize", close);
  document.addEventListener("visibilitychange", close);
}
