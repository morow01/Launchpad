// Keyboard shortcuts:
//   /            jump to the search bar
//   1 – 9        open your first nine shortcuts (Alt+1–9 also works while typing)
//   Shift + 1–9  open in a new background tab
//   E            edit shortcuts        Esc  leave edit mode

import * as settings from "./settings.js";

const TILE_SELECTOR = "#categories .tile:not(.add)";

function isTyping(el) {
  return !!el?.closest?.("input, textarea, select, [contenteditable='true']");
}

/** The shortcut tiles in on-screen order (collapsed categories are skipped). */
function visibleTiles() {
  const custom = [...document.querySelectorAll(TILE_SELECTOR)].filter((t) => t.offsetParent);
  return custom.length ? custom : [...document.querySelectorAll("#recentTiles .tile")].filter((t) => t.offsetParent);
}

function open(url, background) {
  if (!background) return (location.href = url);
  if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url, active: false });
  else window.open(url, "_blank");
}

/** Puts the key number on the first nine tiles (badge + tooltip). */
function annotate() {
  const showBadges = settings.get().showKeyHints;
  document.querySelectorAll(".key-hint").forEach((b) => b.remove());
  visibleTiles().forEach((tile, i) => {
    const url = tile.getAttribute("href");
    if (i >= 9) {
      tile.title = url;
      return;
    }
    tile.title = `${url}\nPress ${i + 1} to open · Shift+${i + 1} for a new tab`;
    if (showBadges) {
      const badge = document.createElement("kbd");
      badge.className = "key-hint";
      badge.textContent = i + 1;
      badge.setAttribute("aria-hidden", "true");
      tile.append(badge);
    }
  });
}

/**
 * @param {{isEditing: () => boolean, setEditing: (on: boolean) => void, focusSearch: () => void}} api
 */
export function initKeys(api) {
  window.addEventListener("newtab:rendered", () => requestAnimationFrame(annotate));
  settings.onChange(() => requestAnimationFrame(annotate));

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
    if (document.querySelector("dialog[open]") || document.querySelector(".panel.open")) return;
    const typing = isTyping(e.target);

    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit && (e.altKey || !typing) && !api.isEditing()) {
      const tile = visibleTiles()[Number(digit[1]) - 1];
      if (!tile) return;
      e.preventDefault();
      tile.animate([{ transform: "scale(.94)" }, { transform: "none" }], { duration: 160 });
      open(tile.href, e.shiftKey);
      return;
    }

    if (typing || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      api.focusSearch();
    } else if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      api.setEditing(!api.isEditing());
    } else if (e.key === "Escape" && api.isEditing()) {
      api.setEditing(false);
    }
  });
}
