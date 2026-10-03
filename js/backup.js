// Backups of shortcuts, settings and the background image.
//
// Automatic backup saves ONE file, at most once a day, to Downloads/NewTab Backup/:
//   newtab-backup-<Weekday>.json — one per weekday, so there's a week of history
// Files survive anything that wipes the extension's own storage — moving the folder,
// reinstalling, clearing site data — which is why backups don't live in Brave's storage.
// If Brave's "Ask where to save each file" is on, Brave shows a save dialog for it;
// cancelling that is remembered (no retry until tomorrow) and explained in Settings.

import * as settings from "./settings.js";
import { getShortcuts, setShortcuts, DEFAULT_CATEGORIES } from "./shortcuts.js";
import { getBackgroundBlob, setBackgroundBlob } from "./background.js";
import { toast } from "./menu.js";

const FOLDER = "NewTab Backup";
const META_KEY = "newtab.backupMeta";        // { hash, time }
const WELCOME_KEY = "newtab.welcomeDone";    // set once the restore prompt has been answered
const DATA_KEYS = ["newtab.categories", "newtab.settings", "newtab.shortcuts"];
const MIN_INTERVAL = 24 * 60 * 60 * 1000;    // auto-backup at most once a day
const DEBOUNCE = 8000;                       // wait for changes to settle

const canDownload = () => !!globalThis.chrome?.downloads?.download;

function readMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; }
}
function writeMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Small, fast string hash (FNV-1a) to tell whether anything changed since the last backup
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export async function buildBackup() {
  const bg = await getBackgroundBlob();
  return {
    app: "my-new-tab",
    version: 2,
    created: new Date().toISOString(),
    settings: settings.get(),
    categories: getShortcuts(),
    background: bg ? await blobToDataUrl(bg) : null,
  };
}

/** Restores a backup object (also accepts files from the old "Export" format). */
export async function restoreBackup(data) {
  const cats = data?.categories || data?.shortcuts;
  if (!data || typeof data !== "object" || (!data.settings && !cats)) {
    throw new Error("This doesn't look like a New Tab backup file.");
  }
  if (data.settings) settings.replace(data.settings);
  if (cats) setShortcuts(cats);
  if (data.background) setBackgroundBlob(await (await fetch(data.background)).blob());
  markWelcomeDone();
}

/**
 * Saves a file to Downloads. Resolves to "complete", "cancelled" (the user closed Brave's
 * save dialog) or "failed". Manual exports resolve as soon as they start.
 */
async function saveFile(filename, text, { ask = false, quiet = false } = {}) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const cleanup = () => setTimeout(async () => {
    URL.revokeObjectURL(url);
    if (quiet) try { await chrome.downloads.setUiOptions({ enabled: true }); } catch {}
  }, 2000);

  if (!canDownload()) {
    // Outside the extension: normal browser download
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.split("/").pop();
    a.click();
    cleanup();
    return "complete";
  }

  try {
    // Hide the download bubble for silent automatic backups (needs "downloads.ui")
    if (quiet) try { await chrome.downloads.setUiOptions({ enabled: false }); } catch {}
    const id = await chrome.downloads.download({
      url, filename, saveAs: ask, conflictAction: ask ? "uniquify" : "overwrite",
    });
    if (!quiet || id === undefined) return "complete";

    // Wait for the automatic backup to finish (or for the user to cancel a save dialog)
    return await new Promise((resolve) => {
      const done = (delta) => {
        if (delta.id !== id || !delta.state || delta.state.current === "in_progress") return;
        chrome.downloads.onChanged.removeListener(done);
        if (delta.state.current === "complete") {
          chrome.downloads.erase({ id }).catch(() => {}); // keep it out of the downloads list
          resolve("complete");
        } else {
          resolve(delta.error?.current === "USER_CANCELED" ? "cancelled" : "failed");
        }
      };
      chrome.downloads.onChanged.addListener(done);
    });
  } catch {
    return "failed";
  } finally {
    cleanup();
  }
}

/** True when there's nothing personal to back up yet (a fresh install). */
export function isUntouched() {
  return JSON.stringify(getShortcuts()) === JSON.stringify(DEFAULT_CATEGORIES) &&
    JSON.stringify(settings.get()) === JSON.stringify(settings.DEFAULTS);
}

let busy = false;
let timer = null;

/** Writes the backup files. `force` skips the "unchanged / too soon" checks. */
export async function backupNow({ force = false } = {}) {
  if (busy || !canDownload()) return false;
  if (isUntouched()) return false; // never overwrite a real backup with a blank setup
  busy = true;
  try {
    const data = await buildBackup();
    const { created, ...content } = data;
    const h = hash(JSON.stringify(content));
    const meta = readMeta();
    if (!force) {
      if (meta.hash === h) return false;
      const wait = MIN_INTERVAL - (Date.now() - (meta.time || 0));
      if (wait > 0) {
        schedule(wait + 1000);
        return false;
      }
    }
    const text = JSON.stringify(data);
    const day = new Date().toLocaleDateString("en-GB", { weekday: "long" });
    const result = await saveFile(`${FOLDER}/newtab-backup-${day}.json`, text, { quiet: true });

    if (result === "cancelled") {
      // Brave asked where to save and the dialog was closed. Don't ask again until tomorrow.
      writeMeta({ ...meta, time: Date.now(), cancelled: true });
      updateStatus();
      if (!force) toast("Backup skipped — see Settings › Backup to stop Brave asking");
      return "cancelled";
    }
    if (result === "failed") return false;
    writeMeta({ hash: h, time: Date.now(), cancelled: false });
    updateStatus();
    return true;
  } catch (err) {
    console.warn("Backup failed:", err);
    return false;
  } finally {
    busy = false;
  }
}

function schedule(delay = DEBOUNCE) {
  if (!settings.get().autoBackup || !canDownload()) return;
  clearTimeout(timer);
  timer = setTimeout(() => backupNow(), delay);
}

// ---- Manual export / import ----

export async function exportBackup() {
  const stamp = new Date().toISOString().slice(0, 10);
  await saveFile(`newtab-backup-${stamp}.json`, JSON.stringify(await buildBackup(), null, 2), { ask: true });
}

const importFile = document.getElementById("importFile");

export function pickAndRestore() {
  importFile.click();
}

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;
  try {
    await restoreBackup(JSON.parse(await file.text()));
    hideWelcome();
    toast("Backup restored");
  } catch (err) {
    alert("Couldn't restore: " + err.message);
  }
});

// ---- Status line & toast ----

function ago(time) {
  const mins = Math.round((Date.now() - time) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return new Date(time).toLocaleDateString();
}

export function updateStatus() {
  const el = document.getElementById("backupStatus");
  if (!el) return;
  if (!canDownload()) {
    el.textContent = "Automatic backup works when the page runs as the Brave extension.";
    return;
  }
  const { time, cancelled } = readMeta();
  if (cancelled) {
    el.textContent =
      "The last automatic backup was skipped because Brave's save dialog was closed. Brave shows that dialog " +
      "when “Ask where to save each file” is on (brave://settings/downloads) — turn it off for silent " +
      "backups, or turn Automatic backup off here. Launchpad won't ask more than once a day.";
    return;
  }
  el.textContent = `Once a day when something changed, to Downloads › ${FOLDER}. ` +
    (time ? `Last backup: ${ago(time)}.` : "No backup yet.");
}

export { toast }; // lives in menu.js; re-exported for older imports

// ---- "Restore from backup?" welcome banner on a fresh start ----

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
    document.getElementById("restoreBtn").addEventListener("click", pickAndRestore);
    document.getElementById("restoreDismiss").addEventListener("click", () => {
      markWelcomeDone();
      banner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished.then(hideWelcome);
    });
  } else {
    markWelcomeDone();
  }

  window.addEventListener("newtab:changed", () => {
    if (!document.getElementById("restoreBanner").hidden && !isUntouched()) {
      markWelcomeDone(); // they've started customising — stop offering the restore
      hideWelcome();
    }
    schedule();
  });

  document.getElementById("backupNow").addEventListener("click", async () => {
    if (!canDownload()) return alert("Automatic backup works when the page runs as the Brave extension. Use Export instead.");
    if (isUntouched()) return toast("Nothing to back up yet");
    const ok = await backupNow({ force: true });
    toast(ok === true ? `Backed up to Downloads › ${FOLDER}` : ok === "cancelled" ? "Backup cancelled" : "Backup failed");
  });
  document.getElementById("exportBtn").addEventListener("click", exportBackup);
  document.getElementById("importBtn").addEventListener("click", pickAndRestore);

  updateStatus();
  setInterval(updateStatus, 60 * 1000);
  schedule(); // catch up on changes made before this version existed
}
