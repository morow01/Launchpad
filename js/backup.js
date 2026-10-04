// Export / import of shortcuts, settings and the background image as a file,
// plus the welcome banner on a fresh start (new PC, moved folder, cleared data).
// Day-to-day safety comes from Sync; a file is for keeping a copy yourself.

import * as settings from "./settings.js";
import { getShortcuts, setShortcuts, DEFAULT_CATEGORIES } from "./shortcuts.js";
import { getBackgroundBlob, setBackgroundBlob } from "./background.js";
import { openPanel } from "./panel.js";
import { toast } from "./menu.js";

const WELCOME_KEY = "newtab.welcomeDone"; // set once the welcome banner has been answered
const DATA_KEYS = ["newtab.categories", "newtab.settings", "newtab.shortcuts"];

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Small, fast string hash (FNV-1a), used by sync to tell whether anything changed
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** True when there's nothing personal here yet (a fresh install). */
export function isUntouched() {
  return JSON.stringify(getShortcuts()) === JSON.stringify(DEFAULT_CATEGORIES) &&
    JSON.stringify(settings.get()) === JSON.stringify(settings.DEFAULTS);
}

export async function buildBackup() {
  const bg = await getBackgroundBlob();
  return {
    app: "my-new-tab", // kept so older Launchpad versions can still import these files
    version: 2,
    created: new Date().toISOString(),
    settings: settings.get(),
    categories: getShortcuts(),
    background: bg ? await blobToDataUrl(bg) : null,
  };
}

/** Loads an exported file's contents (also accepts the older backup / export formats). */
export async function restoreBackup(data) {
  const cats = data?.categories || data?.shortcuts;
  if (!data || typeof data !== "object" || (!data.settings && !cats)) {
    throw new Error("This doesn't look like a Launchpad export file.");
  }
  if (data.settings) settings.replace(data.settings);
  if (cats) setShortcuts(cats);
  if (data.background) await setBackgroundBlob(await (await fetch(data.background)).blob());
  markWelcomeDone();
}

// ---- Export / import ----

export async function exportBackup() {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(await buildBackup(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `launchpad-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const importFile = document.getElementById("importFile");

export function pickAndImport() {
  importFile.click();
}

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;
  try {
    await restoreBackup(JSON.parse(await file.text()));
    hideWelcome();
    toast("Imported — your shortcuts and settings are back");
  } catch (err) {
    alert("Couldn't import: " + err.message);
  }
});

export { toast }; // lives in menu.js; re-exported for older imports

// ---- Welcome banner on a fresh start ----

function markWelcomeDone() {
  try { localStorage.setItem(WELCOME_KEY, "1"); } catch {}
}

function hideWelcome() {
  document.getElementById("restoreBanner").hidden = true;
}

function isFreshStart() {
  try {
    return !localStorage.getItem(WELCOME_KEY) && DATA_KEYS.every((k) => localStorage.getItem(k) === null);
  } catch {
    return false;
  }
}

export function initBackup() {
  const fresh = isFreshStart(); // check before anything gets saved
  const banner = document.getElementById("restoreBanner");
  if (fresh) {
    banner.hidden = false;
    document.getElementById("restoreSync").addEventListener("click", () => openPanel("syncSettings"));
    document.getElementById("restoreBtn").addEventListener("click", pickAndImport);
    document.getElementById("restoreDismiss").addEventListener("click", () => {
      markWelcomeDone();
      banner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished.then(hideWelcome);
    });
  } else {
    markWelcomeDone();
  }

  window.addEventListener("newtab:changed", () => {
    if (!banner.hidden && !isUntouched()) {
      markWelcomeDone(); // they've started customising (or sync loaded their setup)
      hideWelcome();
    }
  });

  document.getElementById("exportBtn").addEventListener("click", exportBackup);
  document.getElementById("importBtn").addEventListener("click", pickAndImport);
}
