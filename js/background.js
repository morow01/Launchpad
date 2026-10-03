// Custom background image. Stored in IndexedDB because images are too big for localStorage.

import { notifyChanged } from "./events.js";

const bgEl = document.getElementById("bg");
const bgFile = document.getElementById("bgFile");
const bgRemove = document.getElementById("bgRemove");
const dimWrap = document.getElementById("dimWrap");
let bgUrl = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("newtab", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDo(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", mode);
    const req = fn(tx.objectStore("kv"));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

const getBg = () => dbDo("readonly", (s) => s.get("background"));
const saveBg = (blob) => dbDo("readwrite", (s) => s.put(blob, "background"));
const clearBg = () => dbDo("readwrite", (s) => s.delete("background"));

function showBg(blob) {
  if (bgUrl) URL.revokeObjectURL(bgUrl);
  bgUrl = blob ? URL.createObjectURL(blob) : null;
  bgEl.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : "";
  document.body.classList.toggle("has-bg", !!blob);
  bgRemove.hidden = !blob;
  dimWrap.hidden = !blob;
}

export function setDim(percent) {
  bgEl.style.setProperty("--dim", percent / 100);
}

// Bumped on every change, so a slow initial load can't overwrite a newer change (e.g. from sync)
let changes = 0;

export async function removeBackground() {
  changes++;
  showBg(null);
  try { await clearBg(); } catch {}
  notifyChanged();
}

/** The current background image (for backups), or null. */
export async function getBackgroundBlob() {
  try { return (await getBg()) || null; } catch { return null; }
}

/** Sets and saves a new background image (used by upload and restore). */
export async function setBackgroundBlob(blob) {
  changes++;
  showBg(blob);
  try { await saveBg(blob); } catch (err) { alert("Couldn't save the background: " + err.message); }
  notifyChanged();
}

export function initBackground() {
  document.getElementById("bgUpload").addEventListener("click", () => bgFile.click());

  bgFile.addEventListener("change", () => {
    const file = bgFile.files[0];
    bgFile.value = "";
    if (file && file.type.startsWith("image/")) setBackgroundBlob(file);
  });

  bgRemove.addEventListener("click", removeBackground);

  const seen = changes;
  getBg().then((blob) => { if (blob && changes === seen) showBg(blob); }).catch(() => {});
}
