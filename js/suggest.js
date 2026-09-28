// Type to filter: as you type in the search bar, a dropdown shows matching shortcuts,
// bookmarks and history. ↑/↓ to move, Enter to open, Shift+Enter for a new tab, Esc to close.
// The first row is always "Search for …" (or "Go to …" for addresses), so Enter still searches
// unless the text clearly matches the start of a shortcut name.

import * as settings from "./settings.js";
import { getShortcuts } from "./shortcuts.js";
import { ENGINES, looksLikeUrl } from "./search.js";
import { smallIconUrl } from "./icons.js";

const MAX = { shortcuts: 5, bookmarks: 4, history: 5 };
const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
const GO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const form = document.getElementById("search");
const input = document.getElementById("q");
const box = document.getElementById("suggest");

let rows = [];     // [{ el, url? }] — url undefined = the search row
let selected = 0;
let seq = 0;       // ignores results from older keystrokes that arrive late

// ---- Matching ----

/** Scores how well `text` matches the query (0 = no match). Prefix matches rank highest. */
function score(text, q) {
  if (!text) return 0;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 100 - Math.min(t.length - q.length, 20) / 2;
  if (t.split(/[\s\-_.:/|·]+/).some((w) => w.startsWith(q))) return 75;
  if (t.includes(q)) return 50;
  // Letters in order, e.g. "ytb" → "YouTube"
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length && q.length > 1 ? 20 : 0;
}

function prettyUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "") + u.search).slice(0, 60);
  } catch {
    return url;
  }
}

const norm = (url) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();

function matchShortcuts(q) {
  const out = [];
  for (const c of getShortcuts()) {
    for (const s of c.items) {
      const sc = Math.max(score(s.name, q), score(prettyUrl(s.url), q) * 0.8);
      if (sc) out.push({ title: s.name, url: s.url, score: sc + 5, icon: s.icon });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX.shortcuts);
}

async function matchBookmarks(q) {
  if (!globalThis.chrome?.bookmarks?.search) return [];
  const found = await chrome.bookmarks.search(q);
  return found
    .filter((b) => b.url && /^https?:/i.test(b.url))
    .map((b) => ({ title: b.title || prettyUrl(b.url), url: b.url, score: Math.max(score(b.title, q), score(prettyUrl(b.url), q) * 0.8) }))
    .filter((b) => b.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX.bookmarks);
}

async function matchHistory(q) {
  if (!globalThis.chrome?.history?.search) return [];
  const found = await chrome.history.search({ text: q, startTime: 0, maxResults: 60 });
  return found
    .filter((h) => /^https?:/i.test(h.url))
    .map((h) => {
      const sc = Math.max(score(h.title, q), score(prettyUrl(h.url), q) * 0.9);
      // Frequently visited pages float up
      return { title: h.title || prettyUrl(h.url), url: h.url, score: sc + Math.min(h.visitCount || 0, 20) };
    })
    .filter((h) => h.score > 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX.history);
}

// ---- Rendering ----

function highlight(el, text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) {
    el.textContent = text;
    return;
  }
  const mark = document.createElement("b");
  mark.textContent = text.slice(i, i + q.length);
  el.append(text.slice(0, i), mark, text.slice(i + q.length));
}

function resultRow(item, q) {
  const a = document.createElement("a");
  a.className = "sg-row";
  a.href = item.url;
  a.setAttribute("role", "option");
  a.tabIndex = -1;

  const icon = document.createElement("img");
  icon.className = "sg-icon";
  icon.alt = "";
  icon.src = item.icon || smallIconUrl(item.url);
  icon.onerror = () => icon.replaceWith(Object.assign(document.createElement("span"), {
    className: "sg-icon sg-letter", textContent: (item.title[0] || "?").toUpperCase(),
  }));

  const text = document.createElement("span");
  text.className = "sg-text";
  const title = document.createElement("span");
  title.className = "sg-title";
  highlight(title, item.title, q);
  const url = document.createElement("span");
  url.className = "sg-url";
  highlight(url, prettyUrl(item.url), q);
  text.append(title, url);

  a.append(icon, text);
  a.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the search box
  a.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.button === 1) return; // let the browser open a new tab
    e.preventDefault();
    go(item.url, e.shiftKey);
  });
  return a;
}

function searchRow(text) {
  const isUrl = looksLikeUrl(text);
  const b = document.createElement("div");
  b.className = "sg-row sg-search";
  b.setAttribute("role", "option");
  const engine = ENGINES[settings.get().searchEngine];
  const label = isUrl ? `Go to ${text}` : `Search for “${text}”`;
  const hint = isUrl ? "" : engine?.url ? engine.name : "";
  b.innerHTML = `<span class="sg-icon sg-glyph">${isUrl ? GO_ICON : SEARCH_ICON}</span>`;
  const t = document.createElement("span");
  t.className = "sg-text";
  const title = document.createElement("span");
  title.className = "sg-title";
  title.textContent = label;
  t.append(title);
  if (hint) {
    const h = document.createElement("span");
    h.className = "sg-url";
    h.textContent = hint;
    t.append(h);
  }
  b.append(t);
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", () => form.requestSubmit());
  return b;
}

function heading(label) {
  const h = document.createElement("div");
  h.className = "sg-heading";
  h.textContent = label;
  return h;
}

function select(i) {
  selected = Math.max(0, Math.min(i, rows.length - 1));
  rows.forEach((r, j) => r.el.classList.toggle("active", j === selected));
  rows[selected]?.el.scrollIntoView({ block: "nearest" });
}

function render(q, text, groups) {
  box.replaceChildren();
  rows = [];
  const add = (el, url) => {
    el.addEventListener("mousemove", () => select(rows.findIndex((r) => r.el === el)));
    rows.push({ el, url });
    box.append(el);
  };

  add(searchRow(text));
  const seen = new Set();
  for (const [label, items] of groups) {
    const fresh = items.filter((it) => !seen.has(norm(it.url)) && seen.add(norm(it.url)));
    if (!fresh.length) continue;
    box.append(heading(label));
    for (const it of fresh) add(resultRow(it, q), it.url);
  }

  // Jump straight to a shortcut when the text clearly matches the start of its name
  const top = groups[0][1][0];
  select(top && top.score >= 90 && !looksLikeUrl(text) ? 1 : 0);
  box.hidden = false;
  form.classList.add("has-suggest");
}

function close() {
  box.hidden = true;
  form.classList.remove("has-suggest");
  rows = [];
}

async function update() {
  const text = input.value.trim();
  const q = text.toLowerCase();
  if (!q || !settings.get().searchSuggestions) return close();
  const mine = ++seq;

  const shortcuts = matchShortcuts(q);
  render(q, text, [["Shortcuts", shortcuts]]); // instant, then fill in the rest
  const [bookmarks, history] = await Promise.all([
    matchBookmarks(q).catch(() => []),
    matchHistory(q).catch(() => []),
  ]);
  if (mine !== seq || input.value.trim().toLowerCase() !== q) return; // typed on meanwhile
  const keep = selected;
  render(q, text, [["Shortcuts", shortcuts], ["Bookmarks", bookmarks], ["History", history]]);
  if (keep > 1) select(keep);
}

function go(url, newTab) {
  close();
  if (!newTab) return (location.href = url);
  if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url, active: false });
  else window.open(url, "_blank");
}

export function initSuggest() {
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(update, 60);
  });
  input.addEventListener("focus", () => { if (input.value.trim()) update(); });
  input.addEventListener("blur", () => setTimeout(close, 120));

  input.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      select(selected + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter") {
      const row = rows[selected];
      if (row?.url) {
        e.preventDefault(); // open the result instead of searching
        go(row.url, e.shiftKey);
      } else {
        close(); // the form's normal search / go-to-address runs
      }
    }
  });
}
