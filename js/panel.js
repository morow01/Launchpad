// The settings window behind the cog button: a sidebar of sections (tabs) and one page per section.
// Inputs with data-setting="key" or data-show="key" are bound to settings automatically,
// so adding a simple option only needs a new input in newtab.html and a default in settings.js.

import * as settings from "./settings.js";
import { THEMES, ACCENTS, resolveTheme } from "./themes.js";
import { LAYOUTS } from "./layouts.js";
import { ENGINES } from "./search.js";
import { resetShortcuts, setEditing } from "./shortcuts.js";
import { removeBackground } from "./background.js";
import { confirmDialog } from "./menu.js";

const panel = document.getElementById("panel");
const scrim = document.getElementById("scrim");
const cog = document.getElementById("cog");

const TAB_KEY = "newtab.settingsTab";

/** Shows one section of the settings window ("look", "page", "shortcuts", "search", "sync", "about"). */
function showTab(name) {
  const pages = [...panel.querySelectorAll(".tab-page")];
  if (!pages.some((p) => p.dataset.page === name)) name = pages[0].dataset.page;
  for (const p of pages) p.hidden = p.dataset.page !== name;
  for (const t of panel.querySelectorAll(".panel-tab")) {
    const on = t.dataset.tab === name;
    t.classList.toggle("on", on);
    t.setAttribute("aria-current", on ? "page" : "false");
  }
  panel.querySelector(".panel-body").scrollTop = 0;
  try { localStorage.setItem(TAB_KEY, name); } catch {}
}

/** Opens the settings window — at the last section used, or at the section holding element `sectionId`. */
export function openPanel(sectionId) {
  panel.classList.add("open");
  scrim.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  const section = sectionId && document.getElementById(sectionId);
  let last = null;
  try { last = localStorage.getItem(TAB_KEY); } catch {}
  showTab(section?.closest(".tab-page")?.dataset.page || last || "look");
  if (section) {
    section.scrollIntoView({ block: "start", behavior: "smooth" });
    section.classList.remove("flash");
    void section.offsetWidth; // restart the highlight animation
    section.classList.add("flash");
    section.querySelector("input")?.focus({ preventScroll: true });
  } else {
    document.getElementById("panelClose").focus();
  }
}

function closePanel() {
  panel.classList.remove("open");
  scrim.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
}

function buildThemeList() {
  const list = document.getElementById("themeList");
  const entries = [["auto", { name: "Auto", auto: true }], ...Object.entries(THEMES)];
  for (const [id, t] of entries) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.dataset.theme = id;
    const preview = document.createElement("div");
    preview.className = "preview";
    if (t.auto) {
      preview.style.background = `linear-gradient(135deg, ${THEMES.light.bg2} 50%, ${THEMES.dark.bg2} 50%)`;
      preview.style.setProperty("--sw-accent", THEMES.light.accent);
    } else {
      preview.style.background = `linear-gradient(135deg, ${t.bg2}, ${t.bg1})`;
      preview.style.setProperty("--sw-accent", t.accent);
    }
    b.append(preview, t.name);
    b.addEventListener("click", () => settings.set({ theme: id }));
    list.append(b);
  }
}

/** Layout picker: one compact button per layout (selection is handled by data-choice="layout"). */
function buildLayoutList() {
  const list = document.getElementById("layoutList");
  for (const [id, l] of Object.entries(LAYOUTS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.value = id;
    b.textContent = l.name;
    b.title = l.description;
    list.append(b);
  }
}

function buildAccentList() {
  const list = document.getElementById("accentList");
  const custom = list.querySelector(".accent-custom");
  for (const a of ACCENTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "accent";
    b.dataset.accent = a.value;
    b.title = a.name;
    b.setAttribute("aria-label", a.name);
    b.style.setProperty("--sw", a.value);
    b.addEventListener("click", () => settings.set({ accent: a.value }));
    list.insertBefore(b, custom);
  }
  const picker = document.getElementById("accentPicker");
  picker.addEventListener("input", () => settings.set({ accent: picker.value }));
  document.getElementById("accentReset").addEventListener("click", () => settings.set({ accent: "" }));
}

function buildEngineList() {
  const select = document.getElementById("engineSelect");
  for (const [id, e] of Object.entries(ENGINES)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id === "default" ? "Browser default" : e.name;
    select.append(opt);
  }
}

function bindInputs() {
  panel.querySelectorAll("[data-setting]").forEach((el) => {
    const key = el.dataset.setting;
    const event = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(event, () => {
      let value = el.value;
      if (el.type === "checkbox") value = el.checked;
      else if (el.type === "range" || el.type === "number") value = Number(el.value);
      settings.set({ [key]: value });
    });
  });

  panel.querySelectorAll("[data-show]").forEach((el) => {
    el.addEventListener("change", () => settings.set({ show: { [el.dataset.show]: el.checked } }));
  });

  // Segmented buttons: <div data-choice="key"><button data-value="…">
  panel.querySelectorAll("[data-choice]").forEach((group) => {
    group.querySelectorAll("button[data-value]").forEach((b) => {
      b.addEventListener("click", () => settings.set({ [group.dataset.choice]: b.dataset.value }));
    });
  });
}

/** Reflect current settings in the panel controls. */
function sync(s) {
  panel.querySelectorAll("[data-setting]").forEach((el) => {
    const value = s[el.dataset.setting];
    if (el.type === "checkbox") el.checked = !!value;
    else if (document.activeElement !== el) el.value = value ?? "";
  });
  panel.querySelectorAll("[data-show]").forEach((el) => { el.checked = !!s.show[el.dataset.show]; });
  panel.querySelectorAll("[data-theme]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.theme === s.theme));
  panel.querySelectorAll("[data-choice]").forEach((group) => {
    group.querySelectorAll("button[data-value]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.value === s[group.dataset.choice]))
    );
  });
  const customAccent = s.accent && !ACCENTS.some((a) => a.value === s.accent);
  panel.querySelectorAll("[data-accent]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.accent === s.accent)));
  const picker = document.getElementById("accentPicker");
  picker.parentElement.setAttribute("aria-pressed", String(!!customAccent));
  picker.parentElement.style.setProperty("--sw", customAccent ? s.accent : "transparent");
  if (document.activeElement !== picker) picker.value = s.accent || resolveTheme(s.theme).accent;
  document.getElementById("accentReset").hidden = !s.accent;
  document.getElementById("dimValue").textContent = s.bgDim + "%";
  document.getElementById("recentValue").textContent = s.recentCount;
  const hidden = s.recentHidden.length;
  document.getElementById("hiddenCount").textContent =
    hidden ? `${hidden} site${hidden === 1 ? "" : "s"} hidden from Recently used` : "";
  document.getElementById("unhideRecent").hidden = !hidden;
}

export function initPanel() {
  buildThemeList();
  buildLayoutList();
  buildEngineList();
  buildAccentList();
  bindInputs();
  settings.onChange(sync);

  cog.addEventListener("click", () => (panel.classList.contains("open") ? closePanel() : openPanel()));
  for (const t of panel.querySelectorAll(".panel-tab")) t.addEventListener("click", () => showTab(t.dataset.tab));
  document.getElementById("panelClose").addEventListener("click", closePanel);
  scrim.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
  });

  document.getElementById("editShortcuts").addEventListener("click", () => {
    if (!settings.get().show.shortcuts) settings.set({ show: { shortcuts: true } });
    closePanel();
    setEditing(true);
  });
  document.getElementById("resetShortcuts").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Start over with the default shortcuts?",
      message: "All your categories and shortcuts are replaced with the starter set.",
      confirm: "Reset shortcuts",
      tone: "danger",
    });
    if (ok) resetShortcuts();
  });

  document.getElementById("unhideRecent").addEventListener("click", () => settings.set({ recentHidden: [] }));

  document.getElementById("resetAll").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Reset everything?",
      message: "All settings, shortcuts and the background go back to how they were at the start. Export first if you want a copy.",
      confirm: "Reset everything",
      tone: "danger",
    });
    if (!ok) return;
    settings.reset();
    resetShortcuts();
    removeBackground();
  });
}
