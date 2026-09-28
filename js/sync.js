// Sync between PCs through a private GitHub Gist.
//
// Each PC keeps a GitHub token (gist scope only) in its own storage — never in settings,
// backups, exports or the Gist. Shortcuts and settings are written to one file in a private
// Gist; every new tab checks for changes from other PCs. Conflicts: the newest change wins.
// The background image isn't synced (too large).

import * as settings from "./settings.js";
import { getShortcuts, setShortcuts } from "./shortcuts.js";
import { hash, isUntouched, backupNow, toast } from "./backup.js";

const STATE_KEY = "newtab.sync";
const FILE = "launchpad-sync.json";
const API = "https://api.github.com";
const PUSH_DELAY = 3000;           // upload this long after the last change
const CHECK_EVERY = 5 * 60 * 1000; // re-check while a tab stays open
const MIN_PULL_GAP = 20 * 1000;    // don't re-check more often than this

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
  return { settings: settings.get(), categories: getShortcuts() };
}

async function push({ keepalive = false } = {}) {
  clearTimeout(pushTimer);
  pushTimer = null;
  const snap = snapshot();
  const h = hash(JSON.stringify(snap));
  if (state.gistId && h === state.pushedHash) {
    state.dirty = false;
    return persist();
  }
  const updated = new Date(state.localUpdated || Date.now()).toISOString();
  const content = JSON.stringify({ app: "launchpad", version: 1, updated, device: state.device, ...snap });
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
  persist();
}

function apply(remote) {
  applying = true;
  try {
    settings.replace(remote.settings);
    setShortcuts(remote.categories);
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

  if (remote.updated === state.lastRemote) {
    // Nothing new from other PCs
    if (state.dirty) return push();
    state.lastSync = Date.now();
    state.error = "";
    return persist();
  }
  // Another PC changed something. Keep ours only if it's newer and not uploaded yet.
  if (state.dirty && (state.localUpdated || 0) > Date.parse(remote.updated)) return push();
  apply(remote);
  toast(`Synced changes from ${remote.device || "another PC"}`);
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
  state = { device: state.device, token };
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
    "OK — use it on this PC (this PC's shortcuts and settings are backed up first, then replaced)\n" +
    "Cancel — keep this PC's setup and upload it instead"
  );
  if (useRemote) {
    if (!isUntouched()) await backupNow({ force: true });
    apply(remote);
    toast(`Sync is on — loaded your setup from ${remote.device || "another PC"}`);
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
  state = { device: state.device };
  persist();
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
  error.hidden = !state.error;
  error.textContent = state.error ? "⚠️ " + state.error : "";
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
      state = { device: state.device, error: err.message };
      persist();
    } finally {
      button.disabled = false;
      button.textContent = "Connect";
    }
  });

  document.getElementById("syncNow").addEventListener("click", () => run(() => (state.dirty ? push() : pull())));
  document.getElementById("syncDisconnect").addEventListener("click", disconnect);
  document.getElementById("syncDevice").addEventListener("change", (e) => {
    state.device = e.target.value.trim() || state.device;
    persist();
    // Re-upload so other PCs show the new name ("changes from Laptop")
    if (connected() && state.gistId) {
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
  setInterval(() => { if (connected() && !document.hidden) run(pull); }, CHECK_EVERY);
  setInterval(renderStatus, 60 * 1000);
  renderStatus();
}
