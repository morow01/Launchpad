// Colour themes. To add one, add an entry here — the settings panel picks it up automatically.
//   scheme: "light" | "dark" (used for native controls)
//   bg1/bg2: page gradient, text/muted: text colours, card/cardHover/border: tiles & search,
//   accent: highlight colour, panel: settings panel & dialog background

export const THEMES = {
  light: {
    name: "Light", scheme: "light",
    bg1: "#eef1f7", bg2: "#dfe6f3", text: "#1b1f2a", muted: "#5d6475",
    card: "rgba(255,255,255,.7)", cardHover: "rgba(255,255,255,.95)", border: "rgba(20,30,60,.1)",
    accent: "#fb542b", panel: "#ffffff",
  },
  dark: {
    name: "Dark", scheme: "dark",
    bg1: "#12141b", bg2: "#1c2130", text: "#eceff5", muted: "#9aa2b4",
    card: "rgba(255,255,255,.06)", cardHover: "rgba(255,255,255,.12)", border: "rgba(255,255,255,.1)",
    accent: "#fb542b", panel: "#1a1d27",
  },
  midnight: {
    name: "Midnight", scheme: "dark",
    bg1: "#0b0f24", bg2: "#2a2266", text: "#eae8ff", muted: "#a6a3d0",
    card: "rgba(255,255,255,.07)", cardHover: "rgba(255,255,255,.13)", border: "rgba(255,255,255,.12)",
    accent: "#8b7cff", panel: "#151836",
  },
  nord: {
    name: "Nord", scheme: "dark",
    bg1: "#2e3440", bg2: "#434c5e", text: "#eceff4", muted: "#aeb7c6",
    card: "rgba(255,255,255,.06)", cardHover: "rgba(255,255,255,.12)", border: "rgba(255,255,255,.1)",
    accent: "#88c0d0", panel: "#343b49",
  },
  forest: {
    name: "Forest", scheme: "dark",
    bg1: "#0f1a14", bg2: "#1f3a2b", text: "#e6f2ea", muted: "#9fbcaa",
    card: "rgba(255,255,255,.06)", cardHover: "rgba(255,255,255,.12)", border: "rgba(255,255,255,.1)",
    accent: "#4cc38a", panel: "#15241c",
  },
  sunset: {
    name: "Sunset", scheme: "light",
    bg1: "#fff1e6", bg2: "#ffcfb8", text: "#3a1f1a", muted: "#8a5a4e",
    card: "rgba(255,255,255,.6)", cardHover: "rgba(255,255,255,.9)", border: "rgba(120,50,30,.12)",
    accent: "#e8573c", panel: "#fff8f3",
  },
  ocean: {
    name: "Ocean", scheme: "light",
    bg1: "#e6f4f9", bg2: "#bfe2ef", text: "#0f2a36", muted: "#4a6b78",
    card: "rgba(255,255,255,.65)", cardHover: "rgba(255,255,255,.92)", border: "rgba(10,60,80,.12)",
    accent: "#0b8bb3", panel: "#f4fbfd",
  },
  mono: {
    name: "Mono", scheme: "light",
    bg1: "#f5f5f5", bg2: "#e6e6e6", text: "#111111", muted: "#666666",
    card: "rgba(255,255,255,.8)", cardHover: "#ffffff", border: "rgba(0,0,0,.1)",
    accent: "#111111", panel: "#ffffff",
  },
};

/** Preset accent colours offered in the settings panel (any colour can be picked too). */
export const ACCENTS = [
  { name: "Brave orange", value: "#fb542b" },
  { name: "Red", value: "#ef4444" },
  { name: "Pink", value: "#ec4899" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Green", value: "#22c55e" },
  { name: "Amber", value: "#f59e0b" },
];

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
let current = "auto";
let currentAccent = "";

/** "auto" follows the Windows light/dark setting. */
export function resolveTheme(id) {
  if (id === "auto" || !THEMES[id]) return THEMES[darkQuery.matches ? "dark" : "light"];
  return THEMES[id];
}

/** Applies a theme, optionally with a custom accent colour instead of the theme's own. */
export function applyTheme(id, accent = "") {
  current = id;
  currentAccent = accent;
  const t = { ...resolveTheme(id) };
  if (/^#[0-9a-f]{6}$/i.test(accent)) t.accent = accent;
  const root = document.documentElement;
  const vars = {
    "--bg1": t.bg1, "--bg2": t.bg2, "--text": t.text, "--muted": t.muted,
    "--card": t.card, "--card-hover": t.cardHover, "--border": t.border, "--accent": t.accent,
    "--p-bg": t.panel, "--p-text": t.text, "--p-muted": t.muted, "--p-border": t.border,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = t.scheme;
}

darkQuery.addEventListener("change", () => {
  if (current === "auto") applyTheme("auto", currentAccent);
});
