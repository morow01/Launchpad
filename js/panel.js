// The settings panel behind the cog button.
// Inputs with data-setting="key" or data-show="key" are bound to settings automatically,
// so adding a simple option only needs a new input in newtab.html and a default in settings.js.

import * as settings from "./settings.js";
import { THEMES, ACCENTS, resolveTheme } from "./themes.js";
import { LAYOUTS } from "./layouts.js";
import { ENGINES } from "./search.js";
import { resetShortcuts, setEditing } from "./shortcuts.js";
import { removeBackground } from "./background.js";

const panel = document.getElementById("panel");
const scrim = document.getElementById("scrim");
const cog = document.getElementById("cog");

/** Opens the settings panel, optionally scrolled to (and highlighting) a section by id. */
export function openPanel(sectionId) {
  panel.classList.add("open");
  scrim.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  const section = sectionId && document.getElementById(sectionId);
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

function buildLayoutList() {
  const list = document.getElementById("layoutList");
  for (const [id, l] of Object.entries(LAYOUTS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "layout-card";
    b.dataset.layout = id;

    const mini = document.createElement("div");
    mini.className = "mini";
    for (const [x, y, w, h, accent] of l.mini) {
      const r = document.createElement("i");
      if (accent) r.className = "a";
      Object.assign(r.style, { left: x + "%", top: y + "%", width: w + "%", height: h + "%" });
      mini.append(r);
    }
    const title = document.createElement("strong");
    title.textContent = l.name;
    const desc = document.createElement("small");
    desc.textContent = l.description;

    b.append(mini, title, desc);
    b.addEventListener("click", () => settings.set({ layout: id }));
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
    opt.textContent = id === "default" ? "Browser default (Brave settings)" : e.name;
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
  panel.querySelectorAll("[data-layout]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layout === s.layout));
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
  document.getElementById("resetShortcuts").addEventListener("click", () => {
    if (confirm("Replace your shortcuts with the default set?")) resetShortcuts();
  });

  document.getElementById("unhideRecent").addEventListener("click", () => settings.set({ recentHidden: [] }));

  document.getElementById("resetAll").addEventListener("click", () => {
    if (!confirm("Reset all settings, shortcuts and the background to defaults?")) return;
    settings.reset();
    resetShortcuts();
    removeBackground();
  });
}
