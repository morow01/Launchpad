// Search engines. "default" hands the query to Brave, which uses whatever engine
// is set in brave://settings/search. The others are optional overrides.

export const ENGINES = {
  default: { name: "Browser default", url: null },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=" },
  google: { name: "Google", url: "https://www.google.com/search?q=" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=" },
};

const form = document.getElementById("search");
const input = document.getElementById("q");
const errorEl = document.getElementById("searchError");

export function looksLikeUrl(text) {
  return !text.includes(" ") && /^(https?:\/\/)?[^\s]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text);
}

export function initSearch(getSettings) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    if (looksLikeUrl(text)) {
      location.href = /^https?:\/\//i.test(text) ? text : "https://" + text;
      return;
    }

    const engine = ENGINES[getSettings().searchEngine] || ENGINES.default;
    if (engine.url) {
      location.href = engine.url + encodeURIComponent(text);
      return;
    }

    // Browser default: let Brave run the search with its own default engine.
    if (!globalThis.chrome?.search?.query) {
      showError(
        "Brave didn't give this page access to your default search engine. " +
        "Reload the extension in brave://extensions, or pick an engine in Settings."
      );
      return;
    }
    try {
      chrome.search.query({ text, disposition: "CURRENT_TAB" }, () => {
        const err = chrome.runtime?.lastError;
        if (err) showError("Default search failed: " + err.message);
      });
    } catch (err) {
      showError("Default search failed: " + err.message);
    }
  });

  input.addEventListener("input", () => { errorEl.hidden = true; });
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

export function updateSearch(settings) {
  const engine = ENGINES[settings.searchEngine];
  input.placeholder = engine?.url ? `Search ${engine.name} or type a URL` : "Search or type a URL";
}

export function focusSearch() {
  if (!form.hidden) input.focus();
}
