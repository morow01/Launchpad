// A small right-click style menu, used by the shortcut tiles.
// Opens at a point, stays on screen, and works with the keyboard (↑ ↓ Enter Esc).

let current = null;

export function closeMenu() {
  current?.remove();
  current = null;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {{label: string, icon?: string, danger?: boolean, onClick: () => void}[] | "-"} items
 *        ("-" adds a divider)
 * @param {string} [heading]
 */
export function showMenu(x, y, items, heading) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "menu context-menu";
  menu.setAttribute("role", "menu");

  if (heading) {
    const h = document.createElement("div");
    h.className = "menu-heading";
    h.textContent = heading;
    menu.append(h);
  }
  for (const item of items) {
    if (item === "-") {
      const hr = document.createElement("div");
      hr.className = "menu-divider";
      menu.append(hr);
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (item.danger) b.classList.add("danger");
    const icon = document.createElement("span");
    icon.className = "menu-icon";
    icon.textContent = item.icon || "";
    const label = document.createElement("span");
    label.textContent = item.label;
    b.append(icon, label);
    b.addEventListener("click", () => {
      closeMenu();
      item.onClick();
    });
    menu.append(b);
  }

  document.body.append(menu);
  // Keep it on screen
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = Math.min(x, innerWidth - w - 8) + scrollX + "px";
  menu.style.top = (y + h > innerHeight - 8 ? Math.max(8, y - h) : y) + scrollY + "px";
  current = menu;
  menu.querySelector("button")?.focus({ preventScroll: true });
}

document.addEventListener("pointerdown", (e) => {
  if (current && !current.contains(e.target)) closeMenu();
}, true);
document.addEventListener("keydown", (e) => {
  if (!current) return;
  const buttons = [...current.querySelectorAll("button")];
  const i = buttons.indexOf(document.activeElement);
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}, true);
window.addEventListener("resize", closeMenu);
window.addEventListener("scroll", closeMenu, { passive: true });
document.addEventListener("visibilitychange", closeMenu);

/** Menu position: the pointer, or under the element when opened from the keyboard (Menu key). */
export function menuPoint(e, el) {
  if (e.clientX || e.clientY) return [e.clientX, e.clientY];
  const r = el.getBoundingClientRect();
  return [r.left, r.bottom + 4];
}

export function openInNewTab(url) {
  if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url, active: false });
  else window.open(url, "_blank");
}

export function copyLink(url) {
  navigator.clipboard.writeText(url).then(
    () => toast("Link copied"),
    () => toast("Couldn't copy the link")
  );
}

// ---- Toast (small notice at the bottom), optionally with an action like "Undo" ----

let toastEl = null;

/** @param {string} message @param {{action?: {label: string, onClick: () => void}, duration?: number}} [opts] */
export function toast(message, { action, duration = action ? 5000 : 2200 } = {}) {
  toastEl?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = message;
  t.append(text);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toast-action";
    b.textContent = action.label;
    b.addEventListener("click", () => {
      t.remove();
      action.onClick();
    });
    t.append(b);
  }
  document.body.append(t);
  toastEl = t;
  setTimeout(() => t.classList.add("out"), duration);
  setTimeout(() => { t.remove(); if (toastEl === t) toastEl = null; }, duration + 400);
}

// ---- Press and hold ----

const HOLD_MS = 550;

/**
 * Calls `onHold` when the element is pressed and held (mouse or touch) without moving.
 * The click that ends a hold is cancelled, so the link isn't followed.
 */
export function onLongPress(el, onHold, { enabled = () => true } = {}) {
  let timer = null;
  let start = null;
  let held = false;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    el.classList.remove("pressing");
  };

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !enabled()) return;
    held = false;
    start = { x: e.clientX, y: e.clientY };
    el.classList.add("pressing");
    timer = setTimeout(() => {
      timer = null;
      held = true;
      el.classList.remove("pressing");
      el.animate([{ transform: "scale(.94)" }, { transform: "scale(1.04)" }, { transform: "none" }], { duration: 260 });
      navigator.vibrate?.(15);
      onHold(e);
    }, HOLD_MS);
  });
  el.addEventListener("pointermove", (e) => {
    if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancel();
  });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("pointercancel", cancel);
  // A hold shouldn't also follow the link
  el.addEventListener("click", (e) => {
    if (held) {
      e.preventDefault();
      e.stopImmediatePropagation();
      held = false;
    }
  }, true);
  // Touch: stop the browser's own long-press menu
  el.addEventListener("contextmenu", (e) => { if (held) e.preventDefault(); });
}
