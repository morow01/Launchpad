import * as settings from "./settings.js";
import { applyTheme } from "./themes.js";
import { LAYOUTS } from "./layouts.js";
import { initClock } from "./clock.js";
import { initSearch, updateSearch, focusSearch } from "./search.js";
import { initShortcuts, getShortcuts, addToCategory, importCategory, isEditing, setEditing } from "./shortcuts.js";
import { renderRecent, setKnownNames } from "./recent.js";
import { initBackground, setDim } from "./background.js";
import { initPanel, openPanel } from "./panel.js";
import { initWeather } from "./weather.js";
import { initSync } from "./sync.js";
import { initAbout } from "./about.js";
import { initBackup } from "./backup.js";
import { initKeys } from "./keys.js";
import { initBookmarkImport } from "./bookmarks.js";
import { initClosed } from "./closed.js";
import { initSuggest } from "./suggest.js";

const TILE_SCALE = { small: 0.8, normal: 1, large: 1.25 };

// Settings key (settings.show.*) -> element id
const WIDGETS = {
  clock: "time",
  date: "date",
  greeting: "greeting",
  search: "search",
  recent: "recentSection",
  shortcuts: "shortcutsWidget",
};

initBackup(); // first: it checks for a fresh start before anything gets saved
const redrawClock = initClock(settings.get);
initSearch(settings.get);
initSuggest();
initWeather({ openSettings: openPanel });
initSync();
initAbout();
initShortcuts();
initBackground();
initPanel();
initBookmarkImport();
initKeys({ isEditing, setEditing, focusSearch });
initClosed();

function refreshRecent() {
  const s = settings.get();
  if (!s.show.recent) return;
  const categories = getShortcuts();
  setKnownNames(categories);
  renderRecent({
    count: s.recentCount,
    hidden: s.recentHidden,
    skipShortcuts: s.recentSkipShortcuts,
    categories,
    onPin: (item, ci, newName) => {
      if (ci === -1) importCategory({ name: newName, items: [item] });
      else addToCategory(ci, item);
    },
    onHide: (host) => settings.set({ recentHidden: [...new Set([...settings.get().recentHidden, host])] }),
  });
}

settings.onChange((s) => {
  applyTheme(s.theme, s.accent);
  document.body.dataset.layout = LAYOUTS[s.layout] ? s.layout : "classic";
  document.body.style.setProperty("--tile-scale", TILE_SCALE[s.tileSize] ?? 1);
  document.body.dataset.tileLabels = s.tileLabels ? "on" : "off";
  document.body.dataset.valign = s.alignTop ? "top" : "default";
  for (const [key, id] of Object.entries(WIDGETS)) {
    document.getElementById(id).hidden = !s.show[key];
  }
  redrawClock();
  updateSearch(s);
  setDim(s.bgDim);
  refreshRecent();
});

// Pinning or editing shortcuts can change what "Recently used" should skip
let recentTimer;
window.addEventListener("newtab:rendered", () => {
  clearTimeout(recentTimer);
  recentTimer = setTimeout(refreshRecent, 50);
});

// Keep "Recently used" fresh when coming back to an open new tab
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshRecent();
});

focusSearch();
