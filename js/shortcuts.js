// Custom shortcut categories: add / edit / remove tiles, add / rename / delete
// categories, and drag tiles to reorder them or move them between categories.

import { makeTile, siteName, cleanTitle, CLOSE_ICON } from "./tiles.js";
import { imageFileToIcon } from "./icons.js";
import { recordVisit } from "./recent.js";
import { notifyChanged, notifyRendered } from "./events.js";
import { showMenu, menuPoint, onLongPress, openInNewTab, copyLink, toast } from "./menu.js";

const CHEVRON_ICON = '<svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';
const OPEN_ALL_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5"/></svg>';

const STORAGE_KEY = "newtab.categories";
const OLD_KEY = "newtab.shortcuts"; // v1 stored a flat list of shortcuts

export const DEFAULT_CATEGORIES = [
  {
    name: "Favourites",
    items: [
      { name: "YouTube", url: "https://www.youtube.com" },
      { name: "Gmail", url: "https://mail.google.com" },
      { name: "GitHub", url: "https://github.com" },
      { name: "Claude", url: "https://claude.ai" },
      { name: "Reddit", url: "https://www.reddit.com" },
      { name: "Wikipedia", url: "https://en.wikipedia.org" },
    ],
  },
];

const categoriesEl = document.getElementById("categories");
const addCategoryWrap = document.getElementById("addCategoryWrap");
const addCategoryBtn = document.getElementById("addCategory");
const newCategoryForm = document.getElementById("newCategoryForm");
const newCategoryName = document.getElementById("newCategoryName");
const editBar = document.getElementById("editBar");
const editInline = document.getElementById("editInline");
const dialog = document.getElementById("shortcutDialog");
const dialogTitle = document.getElementById("dialogTitle");
const nameInput = document.getElementById("scName");
const urlInput = document.getElementById("scUrl");
const monitorInput = document.getElementById("scMonitor");

let categories = load();
let editing = false;
let drag = null;           // active drag state, see onPointerDown
let suppressClick = false; // swallow the click that ends a drag
let dialogTarget = null;   // { cat, index } — index null = adding

// ---- Storage ----

function isItem(s) {
  return s && typeof s.name === "string" && typeof s.url === "string";
}

function normalize(list) {
  // Accepts the current format (categories) or the old flat list of shortcuts
  if (!Array.isArray(list)) return null;
  if (list.every(isItem)) return [{ name: "Favourites", items: list }];
  return list
    .filter((c) => c && Array.isArray(c.items))
    .map((c) => ({
      name: String(c.name ?? "Category"),
      items: c.items.filter(isItem),
      ...(c.collapsed ? { collapsed: true } : {}),
    }));
}

function clone(cats) {
  return cats.map((c) => ({ ...c, items: c.items.map((s) => ({ ...s })) }));
}

function load() {
  for (const key of [STORAGE_KEY, OLD_KEY]) {
    try {
      const cats = normalize(JSON.parse(localStorage.getItem(key)));
      if (cats) return cats;
    } catch {}
  }
  return clone(DEFAULT_CATEGORIES);
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(categories)); } catch {}
  notifyChanged();
}

export function getShortcuts() {
  return categories;
}

/** Adds a shortcut to a category (used by "pin" on Recently used) and highlights it. */
export function addToCategory(ci, item) {
  const cat = categories[ci];
  if (!cat) return;
  cat.items.push(item);
  cat.collapsed = false;
  save();
  render();
  flashTile(ci, cat.items.length - 1);
}

/** Adds a whole new category (used by the bookmarks import). */
export function importCategory(cat) {
  categories.push(cat);
  save();
  render();
  const sections = categoriesEl.querySelectorAll(".category");
  const last = sections[sections.length - 1];
  last?.scrollIntoView({ behavior: "smooth", block: "center" });
  last?.animate(
    [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
    { duration: 350, easing: "ease-out" }
  );
}

function flashTile(ci, index) {
  categoriesEl.querySelector(`.tile[data-cat="${ci}"][data-index="${index}"]`)?.animate(
    [{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1.1)", opacity: 1 }, { transform: "none" }],
    { duration: 400, easing: "ease-out" }
  );
}

// ---- Right-click menu on a tile ----

function showTileMenu(e, tile, ci, i) {
  const s = categories[ci].items[i];
  showMenu(...menuPoint(e, tile), [
    { icon: "✎", label: "Edit…", onClick: () => openDialog(ci, i) },
    { icon: "↗", label: "Open in new tab", onClick: () => openInNewTab(s.url) },
    { icon: "⧉", label: "Copy link", onClick: () => copyLink(s.url) },
    "-",
    { icon: "⠿", label: "Edit all shortcuts", onClick: () => setEditing(true) },
    { icon: "🗑", label: "Remove", danger: true, onClick: () => removeWithUndo(ci, i) },
  ], s.name);
}

function removeWithUndo(ci, i) {
  const cat = categories[ci];
  const [removed] = cat.items.splice(i, 1);
  save();
  render();
  toast(`Removed ${removed.name}`, {
    action: {
      label: "Undo",
      onClick: () => {
        const target = categories.includes(cat) ? cat : categories[0];
        target.items.splice(Math.min(i, target.items.length), 0, removed);
        save();
        render();
        flashTile(categories.indexOf(target), target.items.indexOf(removed));
      },
    },
  });
}

const EASE = "cubic-bezier(.2, .8, .2, 1)";

/** Folds a category up or down with an animation (no full redraw, so it stays smooth). */
function toggleCollapse(cat, section, toggle, count) {
  const tiles = section.querySelector(".tiles");
  if (!tiles || tiles.dataset.animating) return;
  tiles.dataset.animating = "1";
  const collapsing = !cat.collapsed;
  cat.collapsed = collapsing;
  save();

  toggle.setAttribute("aria-expanded", String(!collapsing));
  toggle.title = collapsing ? "Show shortcuts" : "Collapse";
  section.classList.toggle("collapsed", collapsing);
  tiles.style.overflow = "hidden";

  const done = () => {
    tiles.style.overflow = "";
    delete tiles.dataset.animating;
    notifyRendered(); // keyboard numbers follow the visible tiles
  };

  if (collapsing) {
    const h = tiles.offsetHeight;
    tiles.animate(
      [{ height: h + "px", opacity: 1 }, { height: "0px", opacity: 0 }],
      { duration: 280, easing: EASE }
    ).finished.then(() => {
      tiles.hidden = true;
      count.hidden = false;
      count.animate([{ transform: "scale(.4)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 200, easing: "ease-out" });
      done();
    });
  } else {
    count.hidden = true;
    tiles.hidden = false;
    const h = tiles.scrollHeight;
    tiles.animate(
      [{ height: "0px", opacity: 0 }, { height: h + "px", opacity: 1 }],
      { duration: 300, easing: EASE }
    ).finished.then(done);
    // Tiles drop in one after another
    [...tiles.children].forEach((t, i) =>
      t.animate(
        [{ transform: "translateY(-10px) scale(.96)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 260, delay: Math.min(i, 12) * 22, easing: EASE, fill: "backwards" }
      )
    );
  }
}

function openAll(cat) {
  const urls = cat.items.map((s) => s.url);
  if (urls.length > 8 && !confirm(`Open all ${urls.length} shortcuts in new tabs?`)) return;
  for (const url of urls) {
    if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url, active: false });
    else window.open(url, "_blank");
  }
}

export function setShortcuts(list) {
  categories = normalize(list) || clone(DEFAULT_CATEGORIES);
  save();
  render();
}

export function resetShortcuts() {
  setShortcuts(clone(DEFAULT_CATEGORIES));
}

export function isEditing() {
  return editing;
}

export function setEditing(on) {
  editing = on;
  editBar.hidden = !on;
  editInline.hidden = on;
  addCategoryWrap.hidden = !on;
  document.body.classList.toggle("editing-shortcuts", on);
  closeNewCategoryForm();
  render();
}

// ---- Rendering ----

function render() {
  categoriesEl.replaceChildren();
  categoriesEl.classList.toggle("editing", editing);

  categories.forEach((cat, ci) => {
    if (!editing && cat.items.length === 0) return;

    const section = document.createElement("section");
    section.className = "category";

    const head = document.createElement("div");
    head.className = "cat-head";
    section.dataset.cat = ci;
    if (editing) {
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "cat-grip";
      grip.title = "Drag to move category (or use ↑ ↓ keys)";
      grip.setAttribute("aria-label", `Move category ${cat.name}`);
      grip.textContent = "⠿";
      grip.addEventListener("pointerdown", (e) => onCatPointerDown(e, section));
      grip.addEventListener("keydown", (e) => {
        const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        const to = ci + dir;
        if (!dir || to < 0 || to >= categories.length) return;
        e.preventDefault();
        [categories[ci], categories[to]] = [categories[to], categories[ci]];
        save();
        render();
        categoriesEl.querySelector(`.category[data-cat="${to}"] .cat-grip`)?.focus();
      });
      head.append(grip);

      const title = document.createElement("input");
      title.className = "cat-name";
      title.value = cat.name;
      title.maxLength = 30;
      title.setAttribute("aria-label", "Category name");
      title.addEventListener("input", () => { cat.name = title.value; save(); });
      title.addEventListener("keydown", (e) => { if (e.key === "Enter") title.blur(); });
      // ✓ appears while renaming, as a clear "done" action (the name saves as you type)
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "cat-save";
      ok.title = "Save name";
      ok.textContent = "✓";
      ok.addEventListener("click", () => ok.blur());
      const del = document.createElement("button");
      del.type = "button";
      del.className = "cat-delete";
      del.title = "Delete category";
      del.innerHTML = CLOSE_ICON;
      del.addEventListener("click", () => deleteCategory(ci));
      head.append(title, ok, del);
    } else {
      // Click the name to collapse / expand the category
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cat-toggle";
      toggle.setAttribute("aria-expanded", String(!cat.collapsed));
      toggle.title = cat.collapsed ? "Show shortcuts" : "Collapse";
      toggle.innerHTML = CHEVRON_ICON;
      const title = document.createElement("h4");
      title.className = "cat-title";
      title.textContent = cat.name;
      const count = document.createElement("span");
      count.className = "cat-count";
      count.textContent = cat.items.length;
      count.hidden = !cat.collapsed;
      toggle.append(title, count);
      toggle.addEventListener("click", () => toggleCollapse(cat, section, toggle, count));

      const open = document.createElement("button");
      open.type = "button";
      open.className = "cat-action";
      open.title = `Open all ${cat.items.length} in new tabs`;
      open.setAttribute("aria-label", open.title);
      open.innerHTML = OPEN_ALL_ICON;
      open.addEventListener("click", () => openAll(cat));

      head.append(toggle, open);
      if (cat.collapsed) section.classList.add("collapsed");
    }

    const tiles = document.createElement("div");
    tiles.className = "tiles" + (editing ? " editing" : "");
    tiles.dataset.cat = ci;
    tiles.hidden = !!cat.collapsed && !editing;

    cat.items.forEach((s, i) => {
      const tile = makeTile(s, {
        monitor: s.monitor,
        onRemove: () => {
          cat.items.splice(i, 1);
          save();
          render();
        },
      });
      tile.dataset.cat = ci;
      tile.dataset.index = i;
      tile.addEventListener("click", (e) => {
        if (!editing) return recordVisit(s);
        e.preventDefault();
        if (!suppressClick) openDialog(ci, i);
      });
      tile.addEventListener("pointerdown", (e) => onPointerDown(e, tile));
      // Outside edit mode: right-click for a menu, press and hold to edit
      tile.addEventListener("contextmenu", (e) => {
        if (editing) return;
        e.preventDefault();
        showTileMenu(e, tile, ci, i);
      });
      onLongPress(tile, () => openDialog(ci, i), { enabled: () => !editing });
      tiles.append(tile);
    });

    if (editing) {
      // A faded, dashed "+" tile after the shortcuts (see placeAddTiles: it never nudges them)
      const add = document.createElement("button");
      add.type = "button";
      add.className = "tile add";
      add.title = `Add a shortcut to ${cat.name}`;
      add.setAttribute("aria-label", add.title);
      add.innerHTML = '<span class="plus" aria-hidden="true">+</span>';
      add.addEventListener("click", () => openDialog(ci, null));
      tiles.append(add);
    }

    section.append(head, tiles);
    categoriesEl.append(section);
  });

  if (editing) placeAddTiles();
  notifyRendered();
}

/**
 * Puts each category's "+" tile right after its last shortcut without moving the others.
 * Rows are centred, so an extra tile on the last row would re-centre (nudge) that row. If the
 * last row has room, the "+" is laid over the empty space beside it instead; if the row is
 * full, it simply starts the next row (nothing moves sideways then).
 */
function placeAddTiles() {
  for (const tiles of categoriesEl.querySelectorAll(".tiles")) {
    const add = tiles.querySelector(".tile.add");
    const shortcuts = [...tiles.querySelectorAll(".tile:not(.add)")];
    if (!add) continue;
    add.classList.remove("floating");
    add.style.left = add.style.top = add.style.height = "";
    const last = shortcuts[shortcuts.length - 1];
    if (!last || add.offsetTop !== last.offsetTop) continue; // empty category, or it wrapped: fine as is

    // It fits on the last row: take it out of the row and lay it beside the last shortcut
    add.classList.add("floating");
    const gap = parseFloat(getComputedStyle(tiles).columnGap) || 14;
    add.style.left = last.offsetLeft + last.offsetWidth + gap + "px";
    add.style.top = last.offsetTop + "px";
    add.style.height = last.offsetHeight + "px";
  }
}

let placeTimer;
window.addEventListener("resize", () => {
  if (!editing) return;
  clearTimeout(placeTimer);
  placeTimer = setTimeout(placeAddTiles, 80);
});

function deleteCategory(ci) {
  const cat = categories[ci];
  if (cat.items.length && !confirm(`Delete "${cat.name}" and its ${cat.items.length} shortcut(s)?`)) return;
  categories.splice(ci, 1);
  save();
  render();
}

function openNewCategoryForm() {
  addCategoryBtn.parentElement.hidden = true;
  newCategoryForm.hidden = false;
  newCategoryName.value = "";
  newCategoryName.focus();
  newCategoryForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function closeNewCategoryForm() {
  newCategoryForm.hidden = true;
  addCategoryBtn.parentElement.hidden = false;
}

function createCategory(e) {
  e.preventDefault();
  const name = newCategoryName.value.trim();
  if (!name) {
    newCategoryName.focus();
    newCategoryName.animate(
      [{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }],
      { duration: 200, iterations: 2 }
    );
    return;
  }
  categories.push({ name, items: [] });
  save();
  closeNewCategoryForm();
  render();
  const sections = categoriesEl.querySelectorAll(".category");
  sections[sections.length - 1]?.animate(
    [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
    { duration: 300, easing: "ease-out" }
  );
}

// ---- Animated drag to reorder ----
// The grabbed tile lifts and follows the pointer, a dashed placeholder marks where
// it will land, and the other tiles slide out of the way (FLIP animation).
// Tiles can be dropped into any category, including empty ones.

const DRAG_THRESHOLD = 6; // px the pointer must move before a press becomes a drag

function onPointerDown(e, tile) {
  if (!editing || e.button !== 0 || e.target.closest(".remove")) return;
  drag = { tile, startX: e.clientX, startY: e.clientY, started: false };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function startDrag() {
  const { tile } = drag;
  const r = tile.getBoundingClientRect();

  const placeholder = document.createElement("div");
  placeholder.className = "tile-placeholder";
  placeholder.style.width = r.width + "px";
  placeholder.style.height = r.height + "px";
  tile.replaceWith(placeholder);

  document.body.append(tile);
  Object.assign(tile.style, {
    position: "fixed", left: r.left + "px", top: r.top + "px",
    width: r.width + "px", height: r.height + "px", margin: "0",
  });
  tile.classList.add("lifted");
  categoriesEl.classList.add("reordering");

  Object.assign(drag, {
    started: true, placeholder,
    offsetX: drag.startX - r.left, offsetY: drag.startY - r.top,
  });
}

function onPointerMove(e) {
  if (!drag) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
    startDrag();
  }
  e.preventDefault();
  const { tile, placeholder } = drag;
  tile.style.left = e.clientX - drag.offsetX + "px";
  tile.style.top = e.clientY - drag.offsetY + "px";
  placePlaceholder(placeholder, e.clientX, e.clientY);
}

/** Moves the placeholder to where a drop at (x, y) would land. Shared by tile and bookmark drags. */
//
// Works on grid *slots*, not on the tiles currently under the pointer. Tiles slide
// (animate) and wrap between rows as the placeholder moves, so hit-testing them makes
// the placeholder bounce back and forth. Slot positions come from layout (offsetLeft /
// offsetTop), which ignores the slide animations, and since tiles are the same size the
// placeholder ends up in the slot under the pointer — so it stays put until you move on.
function placePlaceholder(placeholder, x, y) {
  // Which category is the pointer over? (Categories themselves don't animate during a tile drag.)
  const section = [...categoriesEl.querySelectorAll(".category")].find((s) => {
    const r = s.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  if (!section) return false;
  const tiles = section.querySelector(".tiles");
  if (!tiles || tiles.hidden) return false; // collapsed category
  placePlaceholderIn(placeholder, tiles, x, y);
  return true;
}

function placePlaceholderIn(placeholder, tiles, x, y) {

  // Find the slot under the pointer, using untransformed layout boxes
  const box = tiles.getBoundingClientRect();
  const px = x - box.left;
  const py = y - box.top;
  // Layout position of a tile inside this row (offsetLeft is relative to the row itself in
  // edit mode, where the row is positioned, and to the page otherwise)
  const pos = (el) =>
    el.offsetParent === tiles
      ? [el.offsetLeft, el.offsetTop]
      : [el.offsetLeft - tiles.offsetLeft, el.offsetTop - tiles.offsetTop];
  const slot = [...tiles.children].find((el) => {
    const [l, t] = pos(el);
    return px >= l && px <= l + el.offsetWidth && py >= t && py <= t + el.offsetHeight;
  });

  if (slot === placeholder) return; // already there
  if (!slot || slot.classList.contains("add")) {
    // Empty space, heading or the "Add" tile: go to the end of this category
    if (placeholder.parentElement !== tiles || placeholder.nextElementSibling !== tiles.querySelector(".add")) {
      if (!slot && placeholder.parentElement === tiles) return; // gaps between tiles: stay put
      animateReflow(() => tiles.insertBefore(placeholder, tiles.querySelector(".add")));
    }
    return;
  }

  // Take the hovered tile's slot: the tile shifts one place toward where the placeholder was
  const items = [...tiles.children];
  const forward = placeholder.parentElement === tiles && items.indexOf(placeholder) < items.indexOf(slot);
  animateReflow(() => (forward ? slot.after(placeholder) : slot.before(placeholder)));
}

function onPointerUp() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  if (!drag) return;
  const { tile, placeholder, started } = drag;
  if (!started) { drag = null; return; } // it was a plain click

  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);

  // Glide the tile into its slot, then commit the new order
  const r = placeholder.getBoundingClientRect();
  tile.classList.add("dropping");
  tile.classList.remove("lifted");
  tile.style.left = r.left + "px";
  tile.style.top = r.top + "px";

  setTimeout(() => {
    const itemAt = (el) => categories[el.dataset.cat].items[el.dataset.index];
    const next = categories.map((c) => ({ ...c, items: [] }));
    for (const tiles of categoriesEl.querySelectorAll(".tiles")) {
      const target = next[tiles.dataset.cat];
      for (const el of tiles.children) {
        if (el === placeholder) target.items.push(itemAt(tile));
        else if (el.dataset.index !== undefined) target.items.push(itemAt(el));
      }
    }
    categories = next;
    drag = null;
    save();
    tile.remove();
    categoriesEl.classList.remove("reordering");
    render();
  }, 200);
}

/** Runs a DOM change, then animates tiles and headings from their old positions to their new ones. */
function animateReflow(change) {
  const items = [...categoriesEl.querySelectorAll(".tile, .tile-placeholder, .cat-head")];
  items.push(addCategoryWrap, editInline);
  const before = new Map(items.map((el) => [el, el.getBoundingClientRect()]));
  change();
  for (const el of items) {
    const a = before.get(el);
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 240, easing: "cubic-bezier(.2, .8, .2, 1)" }
    );
  }
}

// ---- Drag whole categories to reorder them ----

let catDrag = null;

function onCatPointerDown(e, section) {
  if (e.button !== 0 || drag || catDrag) return;
  e.preventDefault();
  const r = section.getBoundingClientRect();

  const placeholder = document.createElement("div");
  placeholder.className = "cat-placeholder";
  placeholder.style.height = r.height + "px";
  section.replaceWith(placeholder);

  document.body.append(section);
  Object.assign(section.style, {
    position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", margin: "0",
  });
  section.classList.add("cat-lifted");
  categoriesEl.classList.add("reordering");
  catDrag = { section, placeholder, offsetY: e.clientY - r.top };

  window.addEventListener("pointermove", onCatPointerMove);
  window.addEventListener("pointerup", onCatPointerUp);
  window.addEventListener("pointercancel", onCatPointerUp);
}

function onCatPointerMove(e) {
  if (!catDrag) return;
  const { section, placeholder } = catDrag;
  section.style.top = e.clientY - catDrag.offsetY + "px";

  // Scroll when dragging near the top or bottom edge
  if (e.clientY < 60) window.scrollBy(0, -12);
  else if (e.clientY > innerHeight - 60) window.scrollBy(0, 12);

  // Where should the placeholder go? Count the categories whose middle is above the pointer.
  // Uses layout positions (offsetTop), which ignore the slide animations, so it doesn't flicker.
  const y = e.clientY - categoriesEl.getBoundingClientRect().top;
  const others = [...categoriesEl.children].filter((el) => el !== placeholder);
  const base = categoriesEl.offsetTop;
  let index = others.findIndex((el) => el.offsetTop - base + el.offsetHeight / 2 > y);
  if (index === -1) index = others.length;

  const current = [...categoriesEl.children].indexOf(placeholder);
  if (current === index) return;
  animateCategories(() => categoriesEl.insertBefore(placeholder, others[index] || null));
}

function onCatPointerUp() {
  window.removeEventListener("pointermove", onCatPointerMove);
  window.removeEventListener("pointerup", onCatPointerUp);
  window.removeEventListener("pointercancel", onCatPointerUp);
  if (!catDrag) return;
  const { section, placeholder } = catDrag;

  // Glide into the slot, then commit the new order
  const r = placeholder.getBoundingClientRect();
  section.classList.add("cat-dropping");
  section.classList.remove("cat-lifted");
  section.style.top = r.top + "px";
  section.style.left = r.left + "px";

  setTimeout(() => {
    const order = [...categoriesEl.children].map((el) =>
      Number(el === placeholder ? section.dataset.cat : el.dataset.cat)
    );
    categories = order.map((i) => categories[i]);
    catDrag = null;
    save();
    section.remove();
    categoriesEl.classList.remove("reordering");
    render();
  }, 220);
}

function animateCategories(change) {
  const items = [...categoriesEl.children];
  const before = new Map(items.map((el) => [el, el.getBoundingClientRect().top]));
  change();
  for (const el of items) {
    const dy = before.get(el) - el.getBoundingClientRect().top;
    if (!dy) continue;
    el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
      { duration: 260, easing: "cubic-bezier(.2, .8, .2, 1)" }
    );
  }
}

// ---- Drop bookmarks / links from outside the page ----
// Brave puts the URL (and usually the title) on the drag when you drag a bookmark,
// a link, or the address bar's site icon onto the page.

let external = null; // { placeholder } while a link is dragged over the page

function isLinkDrag(e) {
  const types = e.dataTransfer?.types || [];
  return !drag && (types.includes("text/uri-list") || types.includes("text/plain"));
}

function parseDroppedLink(dt) {
  let url = "";
  let title = "";
  const uriList = dt.getData("text/uri-list");
  if (uriList) url = uriList.split(/\r?\n/).find((l) => l && !l.startsWith("#")) || "";
  const html = dt.getData("text/html");
  if (html) {
    const a = new DOMParser().parseFromString(html, "text/html").querySelector("a[href]");
    if (a) {
      url ||= a.href;
      title = a.textContent.trim();
    }
  }
  if (!url) url = dt.getData("text/plain").trim();
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) return null;
  } catch {
    return null;
  }
  if (!title || title === url) title = siteName(url);
  return { name: cleanTitle(title) || siteName(url), url };
}

function ensureDropTarget() {
  // Make sure there is at least one category to drop into
  if (!categoriesEl.querySelector(".tiles:not([hidden])")) {
    if (categories.length === 0) categories.push({ name: "Favourites", items: [] });
    setEditing(true);
  }
}

function startExternalDrag() {
  ensureDropTarget();
  const sample = categoriesEl.querySelector(".tile:not(.add)")?.getBoundingClientRect();
  const placeholder = document.createElement("div");
  placeholder.className = "tile-placeholder";
  placeholder.style.width = (sample?.width || 110) + "px";
  placeholder.style.height = (sample?.height || 86) + "px";
  const first = categoriesEl.querySelector(".tiles:not([hidden])");
  animateReflow(() => first.insertBefore(placeholder, first.querySelector(".add")));
  document.body.classList.add("link-dragging");
  external = { placeholder };
}

function endExternalDrag() {
  if (!external) return;
  external.placeholder.remove();
  external = null;
  document.body.classList.remove("link-dragging", "link-over-category");
}

function initLinkDrop() {
  document.addEventListener("dragover", (e) => {
    if (!isLinkDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!external) startExternalDrag();
    external.over = placePlaceholder(external.placeholder, e.clientX, e.clientY);
    document.body.classList.toggle("link-over-category", external.over);
  });

  document.addEventListener("dragleave", (e) => {
    if (external && !e.relatedTarget) endExternalDrag(); // left the window
  });
  // A drag that started on this page (e.g. a Recently used tile) and was cancelled
  document.addEventListener("dragend", endExternalDrag);

  document.addEventListener("drop", (e) => {
    if (!external) return;
    e.preventDefault();
    if (!external.over) return endExternalDrag(); // dropped outside the categories: cancel
    const item = parseDroppedLink(e.dataTransfer);
    const { placeholder } = external;
    const tiles = placeholder.parentElement;
    const ci = Number(tiles?.dataset.cat);
    const index = [...tiles.children].filter((el) => el.dataset.index !== undefined || el === placeholder).indexOf(placeholder);
    endExternalDrag();
    if (!item || Number.isNaN(ci)) return;

    categories[ci].items.splice(index, 0, item);
    save();
    render();
    flashTile(ci, index);
  });
}

// ---- Add / edit dialog ----

const iconInput = document.getElementById("scIcon");
const iconPreview = document.getElementById("scIconPreview");
const iconFile = document.getElementById("scIconFile");
let dialogIcon = ""; // image URL or uploaded data: URL, "" = find automatically

function setDialogIcon(value, { fromInput = false } = {}) {
  dialogIcon = value;
  const uploaded = value.startsWith("data:");
  if (!fromInput) iconInput.value = uploaded ? "" : value;
  iconInput.placeholder = uploaded ? "Uploaded image ✓" : "Paste image address…";
  iconPreview.style.backgroundImage = value ? `url("${value.replace(/"/g, "%22")}")` : "";
  iconPreview.classList.toggle("has-icon", !!value);
}

function openDialog(cat, index) {
  dialogTarget = { cat, index };
  const s = index === null ? { name: "", url: "" } : categories[cat].items[index];
  dialogTitle.textContent = index === null ? `Add to ${categories[cat].name}` : "Edit shortcut";
  nameInput.value = s.name;
  urlInput.value = s.url;
  monitorInput.checked = !!s.monitor;
  setDialogIcon(s.icon || "");
  dialog.returnValue = "";
  dialog.showModal();
  nameInput.focus();
  nameInput.select();
}

/** One-off upgrade: icons uploaded before trimming existed were padded squares — trim them. */
async function retrimOldUploads() {
  let changed = false;
  for (const cat of categories) {
    for (const s of cat.items) {
      if (!s.icon?.startsWith("data:") || s.iconTrimmed) continue;
      try {
        const blob = await (await fetch(s.icon)).blob();
        s.icon = await imageFileToIcon(blob);
        s.iconTrimmed = true;
        changed = true;
      } catch {}
    }
  }
  if (changed) {
    save();
    if (!drag && !external && !dialog.open) render();
  }
}

export function initShortcuts() {
  document.getElementById("editDone").addEventListener("click", () => setEditing(false));
  editInline.addEventListener("click", () => setEditing(true));
  addCategoryBtn.addEventListener("click", openNewCategoryForm);
  newCategoryForm.addEventListener("submit", createCategory);
  document.getElementById("newCategoryCancel").addEventListener("click", closeNewCategoryForm);
  newCategoryName.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNewCategoryForm(); });
  document.getElementById("scCancel").addEventListener("click", () => dialog.close("cancel"));
  retrimOldUploads();
  iconInput.addEventListener("input", () => setDialogIcon(iconInput.value.trim(), { fromInput: true }));
  document.getElementById("scIconClear").addEventListener("click", () => setDialogIcon(""));
  document.getElementById("scIconUpload").addEventListener("click", () => iconFile.click());
  iconFile.addEventListener("change", async () => {
    const file = iconFile.files[0];
    iconFile.value = "";
    if (!file) return;
    try { setDialogIcon(await imageFileToIcon(file)); } catch (err) { alert(err.message); }
  });
  initLinkDrop();

  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "save" || !dialogTarget) return;
    let url = urlInput.value.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const item = { name: nameInput.value.trim(), url };
    if (dialogIcon) item.icon = dialogIcon;
    if (dialogIcon.startsWith("data:")) item.iconTrimmed = true;
    if (monitorInput.checked) item.monitor = true;
    const { cat, index } = dialogTarget;
    if (index === null) categories[cat].items.push(item);
    else categories[cat].items[index] = item;
    save();
    render();
  });

  render();
}
