// Weather next to the clock, from Open-Meteo (free, no account or API key).
// Only the chosen place's coordinates are sent. Results are cached for 20 minutes.

import * as settings from "./settings.js";

const CACHE_KEY = "newtab.weatherCache";
const FRESH_FOR = 20 * 60 * 1000;

// WMO weather codes → [label, day icon, night icon]
const CODES = {
  0: ["Clear", "☀️", "🌙"],
  1: ["Mostly clear", "🌤️", "🌙"],
  2: ["Partly cloudy", "⛅", "☁️"],
  3: ["Cloudy", "☁️", "☁️"],
  45: ["Fog", "🌫️"], 48: ["Freezing fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"],
  56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"],
  61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "🌨️"],
  80: ["Showers", "🌦️"], 81: ["Showers", "🌧️"], 82: ["Heavy showers", "🌧️"],
  85: ["Snow showers", "🌨️"], 86: ["Snow showers", "🌨️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm, hail", "⛈️"], 99: ["Thunderstorm, hail", "⛈️"],
};

function describe(code, isDay = 1) {
  const [label, day, night] = CODES[code] || ["—", "🌡️"];
  return { label, icon: !isDay && night ? night : day };
}

const widget = document.getElementById("weather");
const summary = document.getElementById("weatherSummary");
const details = document.getElementById("weatherDetails");

// ---- Data ----

function cacheKey(loc, unit) {
  return `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)},${unit}`;
}

function readCache(key) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c?.key === key ? c : null;
  } catch {
    return null;
  }
}

async function fetchForecast(loc, unit) {
  const params = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon, timezone: "auto", forecast_days: "5",
    current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    temperature_unit: unit === "f" ? "fahrenheit" : "celsius",
    wind_speed_unit: unit === "f" ? "mph" : "kmh",
  });
  const res = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
  if (!res.ok) throw new Error(`weather service replied ${res.status}`);
  return res.json();
}

/** Town/city search for the settings panel. */
export async function findPlaces(name) {
  const res = await fetch(
    "https://geocoding-api.open-meteo.com/v1/search?" +
    new URLSearchParams({ name, count: "6", language: navigator.language.slice(0, 2) || "en" })
  );
  if (!res.ok) throw new Error(`search replied ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

// ---- Rendering ----

const deg = (n) => `${Math.round(n)}°`;

function renderSetup() {
  summary.innerHTML = "";
  const hint = document.createElement("span");
  hint.className = "weather-setup";
  hint.textContent = "📍 Set up weather";
  summary.append(hint);
  summary.title = "Choose a location for the weather";
  details.hidden = true;
}

function renderWeather(data, loc, unit) {
  const cur = data.current;
  const now = describe(cur.weather_code, cur.is_day);

  summary.innerHTML = "";
  const icon = document.createElement("span");
  icon.className = "weather-icon";
  icon.textContent = now.icon;
  const temp = document.createElement("span");
  temp.className = "weather-temp";
  temp.textContent = deg(cur.temperature_2m);
  const text = document.createElement("span");
  text.className = "weather-text";
  text.textContent = `${now.label} · ${loc.name}`;
  summary.append(icon, temp, text);
  summary.title = "Show forecast";

  // Details: current conditions + next days
  details.innerHTML = "";
  const facts = document.createElement("div");
  facts.className = "weather-facts";
  const wind = unit === "f" ? "mph" : "km/h";
  facts.textContent =
    `Feels like ${deg(cur.apparent_temperature)} · Wind ${Math.round(cur.wind_speed_10m)} ${wind} · Humidity ${cur.relative_humidity_2m}%`;
  const days = document.createElement("div");
  days.className = "weather-days";
  const d = data.daily;
  d.time.forEach((date, i) => {
    const w = describe(d.weather_code[i]);
    const day = document.createElement("div");
    day.className = "weather-day";
    day.title = w.label;
    const name = i === 0 ? "Today" : new Date(date + "T12:00").toLocaleDateString([], { weekday: "short" });
    const rain = d.precipitation_probability_max?.[i];
    day.innerHTML = `<span class="wd-name"></span><span class="wd-icon"></span>` +
      `<span class="wd-temps"><b></b> <span></span></span><span class="wd-rain"></span>`;
    day.querySelector(".wd-name").textContent = name;
    day.querySelector(".wd-icon").textContent = w.icon;
    day.querySelector(".wd-temps b").textContent = deg(d.temperature_2m_max[i]);
    day.querySelector(".wd-temps span").textContent = deg(d.temperature_2m_min[i]);
    day.querySelector(".wd-rain").textContent = rain ? `💧 ${rain}%` : "";
    days.append(day);
  });
  const credit = document.createElement("a");
  credit.className = "weather-credit";
  credit.href = "https://open-meteo.com/";
  credit.textContent = "Weather data by Open-Meteo";
  details.append(facts, days, credit);
}

let lastKey = "";

async function refresh({ force = false } = {}) {
  const s = settings.get();
  if (!s.show.weather) return;
  const loc = s.weather;
  if (!loc) return renderSetup();

  const key = cacheKey(loc, s.weatherUnit);
  const cached = readCache(key);
  if (cached) renderWeather(cached.data, loc, s.weatherUnit); // instant
  if (!force && cached && Date.now() - cached.time < FRESH_FOR) return;

  try {
    const data = await fetchForecast(loc, s.weatherUnit);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key, time: Date.now(), data })); } catch {}
    if (cacheKey(settings.get().weather || loc, settings.get().weatherUnit) === key) renderWeather(data, loc, s.weatherUnit);
  } catch (err) {
    if (!cached) {
      summary.textContent = "🌡️ Weather unavailable";
      summary.title = err.message;
    }
  }
}

// ---- Finding "my location" ----

function preciseLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("location isn't available in this browser"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? "permission denied" : err.message)),
      { timeout: 8000, maximumAge: 60 * 60 * 1000, enableHighAccuracy: false }
    );
  });
}

/** Approximate location from the IP address (GeoJS: free, no key; only used when you click the button). */
async function approximateLocation() {
  const res = await fetch("https://get.geojs.io/v1/ip/geo.json");
  if (!res.ok) throw new Error(`location lookup replied ${res.status}`);
  const g = await res.json();
  const lat = parseFloat(g.latitude);
  const lon = parseFloat(g.longitude);
  if (!isFinite(lat) || !isFinite(lon)) throw new Error("no location in the reply");
  return { name: g.city || g.region || g.country || "Your area", lat, lon };
}

/** Best-effort town name for precise coordinates: the connection's town, if it's nearby. */
async function placeName(lat, lon) {
  try {
    const g = await approximateLocation(); // usually the same town, and gives us a name
    const km = Math.hypot(g.lat - lat, (g.lon - lon) * Math.cos((lat * Math.PI) / 180)) * 111;
    if (km < 40) return g.name;
  } catch {}
  return "Current location";
}

// ---- Settings panel: pick a place ----

function initSettingsSection() {
  const place = document.getElementById("weatherPlace");
  const find = document.getElementById("weatherFind");
  const city = document.getElementById("weatherCity");
  const results = document.getElementById("weatherResults");
  const locate = document.getElementById("weatherLocate");
  const clear = document.getElementById("weatherClear");

  const choose = (loc) => {
    settings.set({ weather: loc, show: { weather: true } });
    results.replaceChildren();
    city.value = "";
  };

  settings.onChange((s) => {
    place.textContent = s.weather ? `Showing weather for ${s.weather.name}.` : "No location set yet.";
    clear.hidden = !s.weather;
  });

  find.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = city.value.trim();
    if (!name) return city.focus();
    results.textContent = "Searching…";
    try {
      const found = await findPlaces(name);
      results.replaceChildren();
      if (!found.length) results.textContent = "No places found — try another spelling.";
      for (const p of found) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "weather-place";
        const n = document.createElement("strong");
        n.textContent = p.name;
        const d = document.createElement("small");
        d.textContent = p.detail;
        b.append(n, d);
        b.addEventListener("click", () => choose({ name: p.name, lat: p.lat, lon: p.lon }));
        results.append(b);
      }
    } catch (err) {
      results.textContent = "Couldn't search: " + err.message;
    }
  });

  // Precise location first; if Windows location is off (Brave then times out), fall back
  // to an approximate location from the internet connection.
  locate.addEventListener("click", async () => {
    results.textContent = "Finding your location…";
    locate.disabled = true;
    try {
      const pos = await preciseLocation();
      choose({ name: await placeName(pos.lat, pos.lon), lat: pos.lat, lon: pos.lon });
    } catch (preciseErr) {
      results.textContent = "Precise location isn't available — trying your approximate location…";
      try {
        choose(await approximateLocation());
        results.textContent = "";
      } catch {
        results.textContent =
          `Couldn't find your location (${preciseErr.message}). Search for your town above instead, ` +
          "or turn on Windows Settings › Privacy & security › Location.";
      }
    } finally {
      locate.disabled = false;
    }
  });

  clear.addEventListener("click", () => settings.set({ weather: null }));
}

export function initWeather({ openSettings }) {
  initSettingsSection();

  summary.addEventListener("click", () => {
    if (!settings.get().weather) return openSettings("weatherSettings");
    details.hidden = !details.hidden;
    widget.classList.toggle("open", !details.hidden);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!widget.contains(e.target)) {
      details.hidden = true;
      widget.classList.remove("open");
    }
  });

  settings.onChange((s) => {
    widget.hidden = !s.show.weather;
    const key = s.weather ? cacheKey(s.weather, s.weatherUnit) : "none";
    if (key !== lastKey) {
      lastKey = key;
      refresh();
    }
  });

  setInterval(() => { if (!document.hidden) refresh(); }, FRESH_FOR);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}
