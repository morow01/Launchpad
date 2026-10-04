# Launchpad

A personal new tab page for Brave (works in any Chromium browser). It includes:
- a clock, search bar, themes, layouts and a custom background
- shortcut categories you can collapse, open all at once, reorder and import from bookmarks
- a "Recently used" row from your history (named from page titles), with pin and hide
- online status dots, keyboard shortcuts, sync between PCs, and export / import

## Install / reload
1. Go to `brave://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. After editing any file, click the reload icon on the extension card, then open a new tab.

## Your data
Shortcuts and settings are stored inside Brave, tied to this extension. Brave identifies an
unpacked extension by its folder path, so **moving or renaming this folder starts it fresh**.
With Sync on, just reconnect and everything comes back.

**Settings → Export & import** saves your shortcuts, settings and background to a file
(`launchpad-<date>.json`), or loads one back. A fresh install offers to set up sync or import a file.

## Updates and other PCs
**Settings → About & other PCs** shows the version and checks GitHub for a newer one. It also has
copy buttons for the install and update commands. After `git pull` it offers a one-click
**Reload Launchpad**. **Sync → Your PCs** lists which version each PC runs.
Bump `version` in `manifest.json` with every change, so the check can tell versions apart.

## Sync between PCs
**Settings → Sync between PCs** keeps shortcuts and settings identical on every PC through a
private Gist (`launchpad-sync.json`) in your GitHub account:
1. Create a token at <https://github.com/settings/tokens/new?scopes=gist&description=Launchpad%20sync>
   with only the **gist** scope, and paste it into the Sync section.
2. Do the same on the other PC. It finds the same Gist and offers to load it.

Changes upload a few seconds after you make them. Every new tab checks for changes from other PCs, and
the newest change wins. The token is stored only on each PC. It is never saved in settings, backups,
exports or the Gist.

The background image syncs through a second private Gist (`launchpad-background.txt`), so the main
sync file stays small. It's shrunk to at most 2560px on the longest side and only uploads when it changes.
You can turn this off with **Sync the background image too**.

## Project layout
```
manifest.json      Extension manifest. Permissions:
                     search       - use Brave's default search engine
                     history      - "Recently used"
                     favicon      - Brave's icon cache
                     bookmarks    - bookmarks folder import
                     sessions, tabs - "Recently closed" tabs (tabs = their titles and addresses)
                     geolocation  - "Use my location" for the weather
newtab.html        Page markup, including the settings panel and dialogs
css/base.css       Colour tokens, widgets, tiles, categories, dialog, background
css/layouts.css    One block per layout: body[data-layout="..."]
css/panel.css      Cog button and settings panel
css/features.css   Collapse/open-all, status dots, pin/hide, bookmarks dialog, banner, toast
css/suggest.css    Search suggestions dropdown
css/weather.css    Weather line, forecast pop-up and weather settings
js/main.js         Entry point: wires the modules together and applies settings
js/settings.js     Settings store (localStorage). Defaults live here
js/events.js       Page-wide events: newtab:changed (drives sync), newtab:rendered
js/backup.js       Export / import to a file, and the welcome banner on a fresh start
js/about.js        Version, update check, reload button, install / update commands
js/sync.js         Sync between PCs via a private GitHub Gist (token stays on each PC)
js/themes.js       Theme colour definitions
js/layouts.js      Layout list and the mini previews shown in the panel
js/clock.js        Clock, date and greeting
js/search.js       Search bar and search engines
js/shortcuts.js    Categories: add/edit/remove, collapse, open all, animated drag, link drops
js/recent.js       "Recently used" row: history, pin to category, hide
js/bookmarks.js    Import a bookmarks folder as a category
js/keys.js         Keyboard shortcuts and the 1–9 number badges
js/menu.js         Right-click menus, press-and-hold, toasts (with Undo)
js/closed.js       "Recently closed" tabs button and list
js/suggest.js      Type to filter: dropdown of matching shortcuts, bookmarks and history
js/weather.js      Weather from Open-Meteo (no key needed) + its settings section
js/status.js       Online/offline dots for shortcuts with "Show online status"
js/tiles.js        Builds a single tile (shared by categories and Recently used)
js/icons.js        Picks the best icon: custom > apple-touch-icon > Brave's favicon cache > Google
js/background.js   Custom background image (IndexedDB)
js/panel.js        Settings panel UI
```

## Common changes
- **New theme:** add an entry to `THEMES` in `js/themes.js`. It appears in the panel automatically.
- **New accent preset:** add it to `ACCENTS` in `js/themes.js`.
- **Tile sizes:** everything scales from `--tile-scale` (see `TILE_SCALE` in `js/main.js` and the top of the tiles section in `css/base.css`).
- **New layout:** add an entry to `LAYOUTS` in `js/layouts.js`, then add a `body[data-layout="id"]` block in `css/layouts.css`.
- **New on/off or text option:** add a default to `DEFAULTS` in `js/settings.js`. Then add an input to the panel in
  `newtab.html` with `data-setting="key"` (or `data-show="key"` for a show/hide toggle). The panel binds it
  automatically. React to the value in the `settings.onChange` callback in `js/main.js`. Sync and export pick it up automatically.
- **New widget:** add its element to `newtab.html`, add a `show` default in `settings.js`, map it in `WIDGETS` in `main.js`, and add a toggle in the panel.

Tip: to debug the page, right-click it and choose **Inspect**.
