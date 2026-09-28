const timeEl = document.getElementById("time");
const dateEl = document.getElementById("date");
const greetingEl = document.getElementById("greeting");

function greetingFor(hour) {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Starts the clock. Returns a function that redraws immediately (call it after settings change). */
export function initClock(getSettings) {
  function tick() {
    const s = getSettings();
    const now = new Date();

    const parts = new Intl.DateTimeFormat([], {
      hour: "2-digit",
      minute: "2-digit",
      second: s.showSeconds ? "2-digit" : undefined,
      hour12: !s.clock24,
    }).formatToParts(now);
    const time = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
    const period = parts.find((p) => p.type === "dayPeriod")?.value;

    timeEl.textContent = time;
    if (period) {
      const small = document.createElement("span");
      small.className = "ampm";
      small.textContent = period;
      timeEl.append(small);
    }

    dateEl.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    const name = s.name.trim();
    greetingEl.textContent = greetingFor(now.getHours()) + (name ? `, ${name}` : "");
  }

  tick();
  setInterval(tick, 1000);
  return tick;
}
