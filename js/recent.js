// "Recently used": generated automatically from Brave's browsing history
// (one tile per site, most recent first). Falls back to the shortcuts you've
// clicked on this page if the history API isn't available.
//
// Each tile can be pinned into a category (📌 button, or drag it onto a category)
// or hidden from the list (eye button).

import { makeTile, siteName } from "./tiles.js";

const CLICKS_KEY = "newtab.recentClicks";
const LOOKBACK_DAYS = 30;

const PIN_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2.5l3.5 3.5-2.5 1-2.5 2.5.5 3-1 1-2.5-2.5L3 13.5M6.5 9.5L4 7l1-1 3 .5L10.5 4z"/></svg>';
const HIDE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="1.8"/><path d="M3 13L13 3"/></svg>';

const section = document.getElementById("recentSection");
const tilesEl = document.getElementById("recentTiles");

/** Known names for common sites, so tiles read "Gmail" rather than "Mail.google". */
let knownNames = new Map();

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

export function setKnownNames(categories) {
  knownNames = new Map();
  for (const c of categories) for (const s of c.items) knownNames.set(hostOf(s.url), s.name);
}

function nameFor(host) {
  return knownNames.get(host) || siteName(host);
}

function uniqueSites(entries, count, skip) {
  const seen = new Set(skip);
  const sites = [];
  for (const { url } of entries) {
    let u;
    try { u = new URL(url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || seen.has(u.hostname)) continue;
    seen.add(u.hostname);
    sites.push({ name: nameFor(u.hostname), url: u.origin });
    if (sites.length >= count) break;
  }
  return sites;
}

async function fromHistory(count, skip) {
  const items = await chrome.history.search({
    text: "",
    startTime: Date.now() - LOOKBACK_DAYS * 864e5,
    maxResults: 1000,
  });
  items.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
  return uniqueSites(items, count, skip);
}

function fromClicks(count, skip) {
  try { return uniqueSites(JSON.parse(localStorage.getItem(CLICKS_KEY)) || [], count, skip); } catch { return []; }
}

/** Remembers a click on a shortcut (used only when history isn't available). */
export function recordVisit(s) {
  try {
    const list = (JSON.parse(localStorage.getItem(CLICKS_KEY)) || []).filter((x) => x.url !== s.url);
    list.unshift({ url: s.url });
    localStorage.setItem(CLICKS_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {}
}

// ---- Pin menu: pick which category to pin a site into ----

let openMenu = null;

function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

function showPinMenu(button, categories, onPick) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  const heading = document.createElement("div");
  heading.className = "menu-heading";
  heading.textContent = "Pin to…";
  menu.append(heading);

  categories.forEach((c, ci) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.textContent = c.name || "Untitled";
    item.addEventListener("click", () => { closeMenu(); onPick(ci); });
    menu.append(item);
  });
  const fresh = document.createElement("button");
  fresh.type = "button";
  fresh.className = "menu-new";
  fresh.textContent = "+ New category…";
  fresh.addEventListener("click", () => {
    const name = prompt("Name for the new category:");
    closeMenu();
    if (name?.trim()) onPick(-1, name.trim());
  });
  menu.append(fresh);

  document.body.append(menu);
  const r = button.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8) + "px";
  menu.style.top = r.bottom + 6 + scrollY + "px";
  menu.querySelector("button")?.focus();
  openMenu = menu;
}

document.addEventListener("pointerdown", (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("resize", closeMenu);

function actionButton(className, title, icon, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = icon;
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(b);
  });
  return b;
}

/**
 * @param {{count: number, hidden: string[], skipShortcuts: boolean, categories: any[],
 *          onPin: (item: {name: string, url: string}, ci: number, newName?: string) => void,
 *          onHide: (host: string) => void}} opts
 */
export async function renderRecent(opts) {
  const skip = new Set(opts.hidden);
  if (opts.skipShortcuts) for (const c of opts.categories) for (const s of c.items) skip.add(hostOf(s.url));

  let sites = [];
  try {
    sites = globalThis.chrome?.history?.search ? await fromHistory(opts.count, skip) : fromClicks(opts.count, skip);
  } catch {
    sites = fromClicks(opts.count, skip);
  }

  const tiles = sites.map((s) => {
    const tile = makeTile(s);
    tile.draggable = true; // drag onto a category to pin it there
    tile.classList.add("recent-tile");
    const actions = document.createElement("div");
    actions.className = "tile-actions";
    actions.append(
      actionButton("tile-act", "Pin to a category", PIN_ICON, (b) =>
        showPinMenu(b, opts.categories, (ci, newName) => opts.onPin(s, ci, newName))
      ),
      actionButton("tile-act", "Hide from Recently used", HIDE_ICON, () => {
        tile.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.8)" }], { duration: 180 })
          .finished.then(() => opts.onHide(hostOf(s.url)));
      })
    );
    tile.append(actions);
    return tile;
  });

  tilesEl.replaceChildren(...tiles);
  section.classList.toggle("empty", sites.length === 0);
}
