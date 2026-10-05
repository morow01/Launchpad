// "About & other PCs" in Settings: version number, update check against GitHub,
// one-click reload after an update, and copyable install / update commands.

import { toast } from "./menu.js";

export const REPO = "morow01/Launchpad";
const LATEST_URL = `https://raw.githubusercontent.com/${REPO}/main/manifest.json`;
const CACHE_KEY = "newtab.latestVersion"; // { version, time }
const CHECK_EVERY = 6 * 60 * 60 * 1000;   // look for a new version at most every 6 hours

export const INSTALL_CMD = `git clone https://github.com/${REPO}.git "$HOME\\Launchpad"`;
export const UPDATE_CMD = `git -C "$HOME\\Launchpad" pull`;
const ZIP_URL = `https://github.com/${REPO}/archive/refs/heads/main.zip`;

/** The version Brave has loaded right now. */
export const VERSION = globalThis.chrome?.runtime?.getManifest?.()?.version || "dev";

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

async function fetchVersion(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`replied ${res.status}`);
  return (await res.json()).version;
}

export async function latestVersion({ force = false } = {}) {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.time < CHECK_EVERY) return cached.version;
  try {
    const version = await fetchVersion(LATEST_URL);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version, time: Date.now() })); } catch {}
    return version;
  } catch {
    return cached?.version || null;
  }
}

/** The version in the folder on disk (newer than VERSION right after a `git pull`). */
async function versionOnDisk() {
  try { return await fetchVersion(new URL("manifest.json", location.href)); } catch { return VERSION; }
}

// ---- Settings panel ----

async function renderAbout({ force = false } = {}) {
  const status = document.getElementById("updateStatus");
  const reload = document.getElementById("reloadExt");
  document.getElementById("appVersion").textContent = VERSION;
  document.getElementById("navVersion").textContent = VERSION;
  status.textContent = "Checking for updates…";
  status.className = "update-status";

  const [disk, latest] = await Promise.all([versionOnDisk(), latestVersion({ force })]);
  reload.hidden = true;
  if (VERSION !== "dev" && compareVersions(disk, VERSION) > 0) {
    status.textContent = `Version ${disk} is downloaded — reload to start using it.`;
    status.classList.add("warn");
    reload.hidden = false;
  } else if (latest && compareVersions(latest, VERSION === "dev" ? disk : VERSION) > 0) {
    status.textContent = `Update available: ${latest}. Run the update command below, then reload.`;
    status.classList.add("warn");
  } else if (latest) {
    status.textContent = "✓ Up to date";
    status.classList.add("ok");
  } else {
    status.textContent = "Couldn't check for updates right now.";
  }
}

function copy(text, what) {
  navigator.clipboard.writeText(text).then(
    () => toast(`${what} copied — paste it into PowerShell`),
    () => toast("Couldn't copy — select the text and press Ctrl+C")
  );
}

export function initAbout() {
  document.getElementById("cmdInstall").textContent = INSTALL_CMD;
  document.getElementById("cmdUpdate").textContent = UPDATE_CMD;
  document.getElementById("zipLink").href = ZIP_URL;
  document.getElementById("repoLink").href = `https://github.com/${REPO}`;

  document.getElementById("copyInstall").addEventListener("click", () => copy(INSTALL_CMD, "Install command"));
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

  // Check when the settings panel opens (and once a while after the page loads)
  const panel = document.getElementById("panel");
  new MutationObserver(() => { if (panel.classList.contains("open")) renderAbout(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  setTimeout(renderAbout, 3000);
}
