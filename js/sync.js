// Sync between PCs through a private GitHub Gist.
//
// Each PC keeps a GitHub token (gist scope only) in its own storage — never in settings,
// backups, exports or the Gist. Shortcuts and settings are written to one file in a private
// Gist; every new tab checks for changes from other PCs. Conflicts: the newest change wins.
// The background image isn't synced (too large).

import * as settings from "./settings.js";
import { getShortcuts, setShortcuts } from "./shortcuts.js";
import { hash, isUntouched, toast, blobToDataUrl } from "./backup.js";
import { getBackgroundBlob, setBackgroundBlob, removeBackground } from "./background.js";
import { VERSION, compareVersions, latestVersionCached } from "./about.js";

const STATE_KEY = "newtab.sync";
const FILE = "launchpad-sync.json";
const API = "https://api.github.com";
const BG_FILE = "launchpad-background.txt"; // background image (data URL) in a second private Gist
const BG_MAX_SIDE = 2560;          // shrink the synced copy to this many pixels on the longest side
const BG_MAX_CHARS = 9 * 1024 * 1024; // give up on images still bigger than this after shrinking
const PUSH_DELAY = 3000;           // upload this long after the last change
const CHECK_EVERY = 5 * 60 * 1000; // re-check while a tab stays open
const MIN_PULL_GAP = 5 * 1000;     // don't re-check more often than this

// state: { token, gistId, device, lastRemote, dirty, localUpdated, pushedHash, lastSync, lastFrom, error }
let state = {};
try { state = JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch {}
if (!state.device) state.device = "PC-" + Math.random().toString(16).slice(2, 6).toUpperCase();

let applying = false;   // true while we apply data from another PC (ignore our own change events)
let queue = Promise.resolve();
let pushTimer = null;
let lastPull = 0;

function persist() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  renderStatus();
}

const connected = () => !!state.token;

// ---- GitHub API ----

class SyncError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

async function api(path, { method = "GET", body, keepalive = false } = {}) {
  const res = await fetch(API + path, {
    method,
    keepalive,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new SyncError("GitHub didn't accept the token — it may have expired or been deleted. Disconnect and connect again with a new token.", "auth");
  if (res.status === 403 || res.status === 422) {
    const scopes = res.headers.get("x-oauth-scopes");
    if (scopes !== null && !scopes.split(/,\s*/).includes("gist")) {
      throw new SyncError("The token doesn't have the “gist” permission. Create a new one with the gist box ticked.", "auth");
    }
    throw new SyncError(`GitHub refused the request (${res.status}). Try again later.`, "http");
  }
  if (res.status === 404) throw new SyncError("not found", "missing");
  if (!res.ok) throw new SyncError(`GitHub replied ${res.status}. Will try again later.`, "http");
  return res.status === 204 ? null : res.json();
}

async function findGist() {
  for (let page = 1; page <= 10; page++) {
    const list = await api(`/gists?per_page=100&page=${page}`);
    const found = list.find((g) => g.files && g.files[FILE]);
    if (found) return found;
    if (list.length < 100) return null;
  }
  return null;
}

async function readRemote(gist) {
  const file = gist?.files?.[FILE];
  if (!file) return null;
  const text = file.truncated ? await (await fetch(file.raw_url, { cache: "no-store" })).text() : file.content;
  try {
    const data = JSON.parse(text);
    return data && data.settings && Array.isArray(data.categories) ? data : null;
  } catch {
    return null;
  }
}

// ---- Sync logic ----

function snapshot() {
  // background: { hash, gist } of the synced image, or null — the image itself is in its own Gist
  return { settings: settings.get(), categories: getShortcuts(), background: state.bgRemote || null };
}

async function push({ keepalive = false } = {}) {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!keepalive) {
    // (skipped when the tab is closing — it goes next time). A background problem never blocks shortcuts.
    try {
      await uploadBackground();
      state.bgError = "";
    } catch (err) {
      if (err.kind === "auth") throw err;
      state.bgError = err.message;
    }
  }
  const snap = snapshot();
  const h = hash(JSON.stringify(snap));
  if (state.gistId && h === state.pushedHash) {
    state.dirty = false;
    lastAction = { kind: "uptodate" };
    return persist();
  }
  const updated = new Date(state.localUpdated || Date.now()).toISOString();
  const content = JSON.stringify({ app: "launchpad", version: 1, updated, device: state.device, devices: deviceList(), ...snap });
  const files = { [FILE]: { content } };

  if (state.gistId) {
    try {
      await api(`/gists/${state.gistId}`, { method: "PATCH", body: { files }, keepalive });
    } catch (err) {
      if (err.kind !== "missing") throw err;
      state.gistId = null; // the Gist was deleted on GitHub — make a new one
    }
  }
  if (!state.gistId) {
    const gist = await api("/gists", {
      method: "POST",
      body: { description: "Launchpad sync — private data for the Launchpad new tab extension", public: false, files },
    });
    state.gistId = gist.id;
  }
  Object.assign(state, { lastRemote: updated, pushedHash: h, dirty: false, lastSync: Date.now(), lastFrom: state.device, error: "" });
  state.versionReported = VERSION;
  lastAction = { kind: "uploaded" };
  persist();
}

// ---- Background image: kept in its own private Gist, so the main sync file stays small ----

const syncsBackground = () => state.syncBackground !== false;

/** Shrinks the image for syncing (longest side 2560px, JPEG) unless that would make it bigger. */
async function compressForSync(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, BG_MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

/** Uploads the background if it changed since the last sync. Updates state.bgRemote. */
async function uploadBackground() {
  if (!syncsBackground()) return;
  const blob = await getBackgroundBlob();
  if (!blob) {
    // Background removed on this PC: tell the other PCs (the old image file is left alone)
    state.bgRemote = null;
    state.bgLocalKey = null;
    return;
  }
  const key = hash(await blobToDataUrl(blob));
  if (key === state.bgLocalKey && state.bgRemote) return; // unchanged

  const small = await blobToDataUrl(await compressForSync(blob));
  if (small.length > BG_MAX_CHARS) {
    throw new SyncError("The background image is too large to sync (even after shrinking it). Your shortcuts still sync.", "http");
  }
  const files = { [BG_FILE]: { content: small } };
  if (state.bgGistId) {
    try {
      await api(`/gists/${state.bgGistId}`, { method: "PATCH", body: { files } });
    } catch (err) {
      if (err.kind !== "missing") throw err;
      state.bgGistId = null;
    }
  }
  if (!state.bgGistId) {
    const gist = await api("/gists", {
      method: "POST",
      body: { description: "Launchpad sync — background image", public: false, files },
    });
    state.bgGistId = gist.id;
  }
  state.bgRemote = { hash: hash(small), gist: state.bgGistId };
  state.bgLocalKey = key;
}

/** Downloads another PC's background if it's different from ours. */
async function downloadBackground(remote) {
  if (!syncsBackground() || !("background" in remote)) return; // older sync files have no background info
  const rb = remote.background;
  if (!rb) {
    if (state.bgRemote) {
      // Removed on the other PC
      await removeBackground();
      state.bgRemote = null;
      state.bgLocalKey = null;
    }
    return;
  }
  if (state.bgRemote?.hash === rb.hash) return;
  const gist = await api(`/gists/${rb.gist}`);
  const file = gist.files?.[BG_FILE];
  if (!file) return;
  const dataUrl = file.truncated ? await (await fetch(file.raw_url, { cache: "no-store" })).text() : file.content;
  await setBackgroundBlob(await (await fetch(dataUrl)).blob());
  state.bgRemote = rb;
  state.bgGistId = rb.gist;
  state.bgLocalKey = hash(dataUrl);
}

async function apply(remote) {
  applying = true; // our own change events (settings, shortcuts, background) aren't new changes
  try {
    settings.replace(remote.settings);
    setShortcuts(remote.categories);
    await downloadBackground(remote).catch((err) => console.warn("Sync: background", err));
  } finally {
    applying = false;
  }
  Object.assign(state, {
    lastRemote: remote.updated,
    pushedHash: hash(JSON.stringify(snapshot())),
    dirty: false,
    lastSync: Date.now(),
    lastFrom: remote.device || "another PC",
    error: "",
  });
  lastAction = { kind: "downloaded", from: remote.device || "another PC" };
  persist();
}

async function pull() {
  lastPull = Date.now();
  if (!state.gistId) return push();
  let gist;
  try {
    gist = await api(`/gists/${state.gistId}`);
  } catch (err) {
    if (err.kind !== "missing") throw err;
    state.gistId = null;
    return push();
  }
  const remote = await readRemote(gist);
  if (!remote) return push();
  if (remote.devices) state.devices = remote.devices;
  // First sync after this PC was updated: report the new version even if nothing else changed
  if (state.versionReported !== VERSION) state.pushedHash = "";

  if (remote.updated === state.lastRemote) {
    // Nothing new from other PCs
    if (state.dirty || state.versionReported !== VERSION) return push();
    state.lastSync = Date.now();
    state.error = "";
    lastAction = { kind: "uptodate" };
    return persist();
  }
  // Another PC changed something. Keep ours only if it's newer and not uploaded yet.
  if (state.dirty && (state.localUpdated || 0) > Date.parse(remote.updated)) return push();
  await apply(remote);
  if (!manualSync) toast(`Synced changes from ${remote.device || "another PC"}`);
}

// ---- "Sync now" button: spinner while working, then a clear result ----

let manualSync = false;  // the button shows its own message, so skip the automatic one
let lastAction = null;   // what the last sync did: { kind: "uploaded" | "downloaded" | "uptodate", from? }

async function syncNow(button) {
  if (button.classList.contains("busy")) return;
  const label = button.textContent;
  button.classList.add("busy");
  button.disabled = true;
  button.innerHTML = '<span class="spinner" aria-hidden="true"></span>Syncing…';
  manualSync = true;
  lastAction = null;
  const started = Date.now();
  try {
    await run(pull); // pull also uploads this PC's changes when it has any
  } finally {
    manualSync = false;
  }
  // Keep the spinner visible briefly so a fast sync still reads as "something happened"
  await new Promise((r) => setTimeout(r, Math.max(0, 500 - (Date.now() - started))));

  const failed = !!state.error || !lastAction;
  button.classList.remove("busy");
  button.classList.add(failed ? "failed" : "done");
  button.textContent = failed ? "⚠ Sync failed" : "✓ Synced";
  if (failed) toast("Sync failed — see the message below the button");
  else if (lastAction.kind === "uploaded") toast("Uploaded your changes — your other PCs pick them up when you switch to them");
  else if (lastAction.kind === "downloaded") toast(`Got the latest changes from ${lastAction.from}`);
  else toast("Already up to date");

  setTimeout(() => {
    button.classList.remove("done", "failed");
    button.textContent = label;
    button.disabled = false;
  }, 2000);
}

/** Runs sync jobs one at a time and shows errors in the panel. */
function run(job) {
  queue = queue
    .then(job)
    .catch((err) => {
      state.error = err.message;
      persist();
      if (err.kind !== "auth") console.warn("Sync:", err);
    });
  return queue;
}

function onLocalChange() {
  if (!connected() || applying) return;
  state.dirty = true;
  state.localUpdated = Date.now();
  persist();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => run(push), PUSH_DELAY);
}

// ---- Connect / disconnect ----

async function connect(token) {
  state = { device: state.device, syncBackground: state.syncBackground, token };
  persist();
  const gist = await findGist();
  if (!gist) {
    state.dirty = true;
    state.localUpdated = Date.now();
    await push(); // first PC: upload this one's setup
    toast("Sync is on — this PC's setup is uploaded");
    return;
  }
  state.gistId = gist.id;
  const remote = await readRemote(await api(`/gists/${gist.id}`));
  if (!remote) {
    state.dirty = true;
    state.localUpdated = Date.now();
    return push();
  }
  const when = new Date(remote.updated).toLocaleString();
  const useRemote = isUntouched() || confirm(
    `Found Launchpad data synced from “${remote.device || "another PC"}” (${when}).\n\n` +
    "OK — use it on this PC (replaces this PC's shortcuts and settings; you can undo right after)\n" +
    "Cancel — keep this PC's setup and upload it instead"
  );
  if (useRemote) {
    // Remember this PC's own setup so the switch can be undone
    const before = isUntouched() ? null : JSON.parse(JSON.stringify({ settings: settings.get(), categories: getShortcuts() }));
    await apply(remote);
    const message = `Sync is on — loaded your setup from ${remote.device || "another PC"}`;
    if (!before) return toast(message);
    toast(message, {
      duration: 10000,
      action: {
        label: "Undo",
        onClick: () => {
          // Putting this PC's setup back is a normal change, so it then syncs to the other PCs
          settings.replace(before.settings);
          setShortcuts(before.categories);
          toast("This PC's setup is back — it's now the synced one");
        },
      },
    });
  } else {
    state.dirty = true;
    state.localUpdated = Date.now();
    await push();
    toast("Sync is on — this PC's setup is uploaded");
  }
}

function disconnect() {
  if (!confirm("Stop syncing this PC? Your shortcuts stay here, and the data on GitHub isn't deleted.")) return;
  clearTimeout(pushTimer);
  state = { device: state.device, syncBackground: state.syncBackground };
  persist();
}

// ---- Your PCs: which version each one runs ----

const FORGET_AFTER = 60 * 864e5; // drop PCs that haven't synced for 60 days

/** The PCs list to upload: everyone we know of, plus this PC with its current version. */
function deviceList() {
  const list = { ...(state.devices || {}) };
  if (state.oldDevice) delete list[state.oldDevice];
  state.oldDevice = null;
  for (const [name, d] of Object.entries(list)) if (Date.now() - (d.seen || 0) > FORGET_AFTER) delete list[name];
  list[state.device] = { version: VERSION, seen: Date.now() };
  state.devices = list;
  return list;
}

function renderDevices() {
  const box = document.getElementById("syncDevices");
  if (!box) return;
  const list = Object.entries(state.devices || {});
  box.replaceChildren();
  if (!list.length) return;
  const latest = latestVersionCached();
  const heading = document.createElement("small");
  heading.textContent = "Your PCs";
  box.append(heading);
  list.sort(([a], [b]) => (a === state.device ? -1 : b === state.device ? 1 : a.localeCompare(b)));
  for (const [name, d] of list) {
    const row = document.createElement("div");
    row.className = "device";
    const who = document.createElement("span");
    who.textContent = name;
    if (name === state.device) {
      const me = document.createElement("small");
      me.textContent = " (this PC)";
      who.append(me);
    }
    const ver = document.createElement("span");
    ver.className = "ver";
    const old = latest && compareVersions(d.version, latest) < 0;
    ver.textContent = old ? `${d.version} — update available` : latest ? `${d.version} ✓` : d.version;
    if (old) ver.classList.add("old");
    else if (latest) ver.classList.add("ok");
    ver.title = `Last synced ${new Date(d.seen).toLocaleString()}`;
    row.append(who, ver);
    box.append(row);
  }
}

// ---- Settings panel ----

function ago(time) {
  const mins = Math.round((Date.now() - time) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : new Date(time).toLocaleDateString();
}

function renderStatus() {
  const off = document.getElementById("syncOff");
  if (!off) return;
  const on = document.getElementById("syncOn");
  const status = document.getElementById("syncStatus");
  const error = document.getElementById("syncError");
  off.hidden = connected();
  on.hidden = !connected();
  const problem = state.error || (connected() && syncsBackground() ? state.bgError : "");
  error.hidden = !problem;
  error.textContent = problem ? "⚠️ " + problem : "";
  const bgToggle = document.getElementById("syncBackground");
  if (bgToggle) bgToggle.checked = syncsBackground();
  if (connected()) {
    const parts = [];
    if (state.dirty) parts.push("Uploading changes…");
    else if (state.lastSync) parts.push(`✓ Synced ${ago(state.lastSync)}`);
    else parts.push("Connecting…");
    if (state.lastFrom && state.lastFrom !== state.device) parts.push(`last change from ${state.lastFrom}`);
    status.textContent = parts.join(" · ");
    const link = document.getElementById("syncGistLink");
    link.hidden = !state.gistId;
    if (state.gistId) link.href = `https://gist.github.com/${state.gistId}`;
    renderDevices();
    const device = document.getElementById("syncDevice");
    if (document.activeElement !== device) device.value = state.device;
  }
}

export function initSync() {
  const form = document.getElementById("syncConnect");
  const tokenInput = document.getElementById("syncToken");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) return tokenInput.focus();
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "Connecting…";
    try {
      await connect(token);
      tokenInput.value = "";
    } catch (err) {
      state = { device: state.device, syncBackground: state.syncBackground, error: err.message };
      persist();
    } finally {
      button.disabled = false;
      button.textContent = "Connect";
    }
  });

  document.getElementById("syncNow").addEventListener("click", (e) => syncNow(e.currentTarget));
  document.getElementById("syncDisconnect").addEventListener("click", disconnect);
  document.getElementById("syncDevice").addEventListener("change", (e) => {
    const renamed = e.target.value.trim();
    if (renamed && renamed !== state.device) state.oldDevice = state.device;
    state.device = renamed || state.device;
    persist();
    // Re-upload so other PCs show the new name ("changes from Laptop")
    if (connected() && state.gistId) {
      state.pushedHash = "";
      run(push);
    }
  });

  document.getElementById("syncBackground").addEventListener("change", (e) => {
    state.syncBackground = e.target.checked;
    state.bgError = "";
    if (state.syncBackground) state.bgLocalKey = null; // upload the current background now
    persist();
    if (connected() && state.syncBackground) {
      state.pushedHash = "";
      run(push);
    }
  });

  window.addEventListener("newtab:changed", onLocalChange);

  // Check for changes from other PCs when a tab opens or comes back into view
  if (connected()) run(pull);
  document.addEventListener("visibilitychange", () => {
    if (!connected()) return;
    if (document.hidden) {
      // Leaving the tab with an upload still waiting: send it now
      if (pushTimer) run(() => push({ keepalive: true }));
    } else if (Date.now() - lastPull > MIN_PULL_GAP) {
      run(pull);
    }
  });
  // Switching between windows (e.g. your PC and a VM) doesn't hide the tab, so also react to
  // the window losing / getting focus: upload waiting changes, then check for new ones.
  window.addEventListener("blur", () => {
    if (connected() && pushTimer) run(push);
  });
  window.addEventListener("focus", () => {
    if (connected() && Date.now() - lastPull > MIN_PULL_GAP) run(pull);
  });
  setInterval(() => { if (connected() && !document.hidden) run(pull); }, CHECK_EVERY);
  setInterval(renderStatus, 60 * 1000);
  renderStatus();
}
