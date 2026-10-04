// Central settings store. Everything the settings panel changes lives here
// and is saved to localStorage. Add a new setting by adding it to DEFAULTS.

import { notifyChanged } from "./events.js";

const KEY = "newtab.settings";

export const DEFAULTS = {
  theme: "auto",          // id from js/themes.js, or "auto"
  layout: "classic",      // id from js/layouts.js
  alignTop: false,        // move page content up instead of the layout's default position
  accent: "",             // custom highlight colour (#rrggbb); "" = the theme's own
  tileSize: "normal",     // "small" | "normal" | "large"
  tileLabels: true,       // show names under tile icons (off = icon-only tiles)
  show: { clock: true, date: true, weather: true, greeting: true, search: true, recent: true, shortcuts: true, closed: true },
  weather: null,          // { name, lat, lon } — the place for the weather, null = not set up yet
  weatherUnit: /^en-(US|LR|MM)$/.test(navigator.language) ? "f" : "c",
  recentCount: 6,
  recentHidden: [],         // hostnames hidden from "Recently used"
  recentSkipShortcuts: true, // don't repeat sites that are already in your shortcuts
  showKeyHints: true,       // show 1–9 key numbers on the first nine shortcuts
  clock24: true,
  showSeconds: false,
  name: "",
  searchEngine: "default", // id from js/search.js — "default" = Brave's own default engine
  searchSuggestions: true,  // dropdown of matching shortcuts / bookmarks / history while typing
  bgDim: 30,
};

const listeners = new Set();
let state = load();

function merge(base, patch) {
  return { ...base, ...patch, show: { ...base.show, ...(patch.show || {}) } };
}

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  // Migrate the dim value from the previous version
  try {
    const oldDim = localStorage.getItem("newtab.bgDim");
    if (oldDim !== null && saved.bgDim === undefined) saved.bgDim = Number(oldDim);
  } catch {}
  return merge(DEFAULTS, saved);
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  notifyChanged();
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

export function get() {
  return state;
}

export function set(patch) {
  state = merge(state, patch);
  save();
  notify();
}

export function replace(all) {
  state = merge(DEFAULTS, all || {});
  save();
  notify();
}

export function reset() {
  replace({});
}

/** Calls fn now and whenever settings change. */
export function onChange(fn) {
  listeners.add(fn);
  fn(state);
}
