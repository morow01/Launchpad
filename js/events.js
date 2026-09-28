// Tiny page-wide events so modules can react to each other without importing each other.
//   newtab:changed  — saved data changed (shortcuts, settings, background) → used by auto-backup
//   newtab:rendered — the shortcut tiles were redrawn → used by keyboard shortcut hints

export const notifyChanged = () => window.dispatchEvent(new Event("newtab:changed"));
export const notifyRendered = () => window.dispatchEvent(new Event("newtab:rendered"));
