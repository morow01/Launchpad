// "About" in Settings: the running version, update check against GitHub, the automatic
// updates status, and the setup / update commands.
//
// Brave reads this extension's page files from the folder every time a new tab opens, so
// once new files are in the folder (update.ps1 puts them there) the next new tab already
// runs them. Only a changed manifest (e.g. a new permission) needs the extension reloaded.

import { toast } from "./menu.js";

export const REPO = "morow01/Launchpad";
const LATEST_URL = `https://raw.githubusercontent.com/${REPO}/main/manifest.json`;
const CACHE_KEY = "newtab.latestVersion"; // { version, time }
const CHECK_EVERY = 6 * 60 * 60 * 1000;   // look for a new version at most every 6 hours
const AUTO_STALE = 3 * 60 * 60 * 1000;    // the hourly updater counts as stopped after this long

/** One command per PC: installs Launchpad if needed and switches on automatic updates. */
export const SETUP_CMD = `irm https://raw.githubusercontent.com/${REPO}/main/install.ps1 | iex`;
export const UPDATE_CMD = `powershell -ExecutionPolicy Bypass -File "$HOME\\Launchpad\\update.ps1"`;
const ZIP_URL = `https://github.com/${REPO}/archive/refs/heads/main.zip`;

/** What Brave loaded when the extension started (only the manifest matters here). */
const loadedManifest = globalThis.chrome?.runtime?.getManifest?.() || null;

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`replied ${res.status}`);
  return res.json();
}

const diskManifest = () => fetchJson(new URL("manifest.json", location.href)).catch(() => null);

// The version of the files this page is actually running (the folder's manifest)
let running = loadedManifest?.version || "dev";
export const versionReady = diskManifest().then((m) => { if (m?.version) running = m.version; });

/** The version this page is running. Wait for `versionReady` first for the exact value. */
export function getVersion() {
  return running;
}

/** -1 if a < b, 0 if equal, 1 if a > b ("2.10" > "2.9"). */
export function compareVersions(a = "0", b = "0") {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch { return null; }
}

/** The newest version on GitHub (cached), or null if it couldn't be checked yet. */
export function latestVersionCached() {
  return readCache()?.version || null;
}

export async function latestVersion({ force = false } = {}) {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.time < CHECK_EVERY) return cached.version;
  try {
    const { version } = await fetchJson(LATEST_URL);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version, time: Date.now() })); } catch {}
    return version;
  } catch {
    return cached?.version || null;
  }
}

/** True when the folder's manifest asks for something Brave hasn't loaded yet (a reload fixes it). */
function needsReload(disk) {
  if (!loadedManifest || !disk) return false;
  const perms = (m) => [...(m.permissions || [])].sort().join(",");
  return perms(loadedManifest) !== perms(disk);
}

/** What update.ps1 last did on this PC, or null if automatic updates were never set up here. */
const autoUpdateStatus = () => fetchJson(new URL("autoupdate-status.json", location.href)).catch(() => null);

function ago(time) {
  const mins = Math.round((Date.now() - time) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs} h ago` : `${Math.round(hrs / 24)} days ago`;
}

// ---- Settings window ----

function setStatus(el, text, tone) {
  el.textContent = text;
  el.className = "update-status" + (tone ? " " + tone : "");
}

async function renderAbout({ force = false } = {}) {
  const status = document.getElementById("updateStatus");
  const auto = document.getElementById("autoStatus");
  const reload = document.getElementById("reloadExt");
  setStatus(status, "Checking for updates…");

  const [disk, latest, updater] = await Promise.all([diskManifest(), latestVersion({ force }), autoUpdateStatus()]);
  if (disk?.version) running = disk.version;
  document.getElementById("appVersion").textContent = running;
  document.getElementById("navVersion").textContent = running;

  const autoOn = !!updater && Date.now() - Date.parse(updater.checked) < AUTO_STALE;
  reload.hidden = !needsReload(disk);

  if (!reload.hidden) {
    setStatus(status, "This update needs a quick reload to finish.", "warn");
  } else if (latest && compareVersions(latest, running) > 0) {
    setStatus(status, autoOn
      ? `Version ${latest} is out — it arrives by itself within the hour.`
      : `Update available: ${latest}. Use a command below to get it.`, "warn");
  } else if (latest) {
    setStatus(status, "✓ Up to date", "ok");
  } else {
    setStatus(status, "Couldn't check for updates right now.");
  }

  if (!updater) {
    setStatus(auto, "Off on this PC. Run the setup command below once to switch them on.");
  } else if (updater.error) {
    setStatus(auto, `Last try (${ago(Date.parse(updater.checked))}) didn't work: ${updater.error}`, "warn");
  } else if (autoOn) {
    setStatus(auto, `✓ On · last checked ${ago(Date.parse(updater.checked))}`, "ok");
  } else {
    setStatus(auto, `Not running — last checked ${ago(Date.parse(updater.checked))}. Run the setup command below again.`, "warn");
  }
}

function copy(text, what) {
  navigator.clipboard.writeText(text).then(
    () => toast(`${what} copied — paste it into PowerShell`),
    () => toast("Couldn't copy — select the text and press Ctrl+C")
  );
}

export function initAbout() {
  document.getElementById("cmdInstall").textContent = SETUP_CMD;
  document.getElementById("cmdUpdate").textContent = UPDATE_CMD;
  document.getElementById("zipLink").href = ZIP_URL;
  document.getElementById("repoLink").href = `https://github.com/${REPO}`;
  versionReady.then(() => { document.getElementById("navVersion").textContent = running; });

  document.getElementById("copyInstall").addEventListener("click", () => copy(SETUP_CMD, "Setup command"));
  document.getElementById("copyUpdate").addEventListener("click", () => copy(UPDATE_CMD, "Update command"));
  document.getElementById("checkUpdates").addEventListener("click", () => renderAbout({ force: true }));
  document.getElementById("reloadExt").addEventListener("click", () => {
    if (globalThis.chrome?.runtime?.reload) chrome.runtime.reload();
    else location.reload();
  });
  document.getElementById("openExtensions").addEventListener("click", () => {
    // Extensions may open the browser's own extensions page (brave:// is the same as chrome://)
    if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url: "chrome://extensions" });
    else copy("brave://extensions", "Address");
  });

  // Check when the settings window opens (and once a while after the page loads)
  const panel = document.getElementById("panel");
  new MutationObserver(() => { if (panel.classList.contains("open")) renderAbout(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  setTimeout(renderAbout, 3000);
}
