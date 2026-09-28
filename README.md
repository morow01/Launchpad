# Launchpad

A personal new tab page for Brave (works in any Chromium browser). It includes:
- a clock, search bar, themes, layouts and a custom background
- shortcut categories you can collapse, open all at once, reorder and import from bookmarks
- a "Recently used" row from your history, with pin and hide
- online status dots, keyboard shortcuts and automatic backups

## Install / reload
1. Go to `brave://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. After editing any file, click the reload icon on the extension card, then open a new tab.

## Your data and backups
Shortcuts and settings are stored inside Brave, tied to this extension. Brave identifies an
unpacked extension by its folder path, so **moving or renaming this folder starts it fresh**.

With **Settings → Backup → Automatic backup** on (the default), a copy is saved to
`Downloads/NewTab Backup/` whenever something changes, at most every 30 minutes:
- `newtab-backup.json` is always the latest copy.
- `newtab-backup-<Weekday>.json` keeps one copy per weekday, so you can go back up to a week.

Backups include the background image. After a move or reinstall, the page offers
**Restore from backup**. You can also restore any time with **Settings → Backup → Restore…**.

## Sync between PCs
**Settings → Sync between PCs** keeps shortcuts and settings identical on every PC through a
private Gist (`launchpad-sync.json`) in your GitHub account:
1. Create a token at <https://github.com/settings/tokens/new?scopes=gist&description=Launchpad%20sync>
   with only the **gist** scope, and paste it into the Sync section.
2. Do the same on the other PC. It finds the same Gist and offers to load it.

Changes upload a few seconds after you make them. Every new tab checks for changes from other PCs, and
the newest change wins. The token is stored only on each PC. It is never saved in settings, backups,
exports or the Gist. Background images don't sync.

## Project layout
```
manifest.json      Extension manifest. Permissions:
                     search       - use Brave's default search engine
                     history      - "Recently used"
                     favicon      - Brave's icon cache
                     bookmarks    - bookmarks folder import
                     downloads(+.ui) - automatic backup files
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
js/events.js       Page-wide events: newtab:changed (drives backup), newtab:rendered
js/backup.js       Automatic backup, export, restore, "restore from backup" banner
js/sync.js         Sync between PCs via a private GitHub Gist (token stays on each PC)
js/themes.js       Theme colour definitions
js/layouts.js      Layout list and the mini previews shown in the panel
js/clock.js        Clock, date and greeting
js/search.js       Search bar and search engines
js/shortcuts.js    Categories: add/edit/remove, collapse, open all, animated drag, link drops
js/recent.js       "Recently used" row: history, pin to category, hide
js/bookmarks.js    Import a bookmarks folder as a category
js/keys.js         Keyboard shortcuts and the 1–9 number badges
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
  automatically. React to the value in the `settings.onChange` callback in `js/main.js`. Backups pick it up automatically.
- **New widget:** add its element to `newtab.html`, add a `show` default in `settings.js`, map it in `WIDGETS` in `main.js`, and add a toggle in the panel.

Tip: to debug the page, right-click it and choose **Inspect**.
