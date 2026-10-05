// "Import bookmarks folder": pick a folder from Brave's bookmarks and turn it into a category.

import { siteName, cleanTitle } from "./tiles.js";
import { importCategory } from "./shortcuts.js";
import { alertDialog } from "./menu.js";

const dialog = document.getElementById("bookmarkDialog");
const list = document.getElementById("bookmarkFolders");
const includeSub = document.getElementById("bookmarkSubfolders");

function isWebLink(node) {
  return node.url && /^https?:/i.test(node.url);
}

function links(folder, deep) {
  const out = [];
  for (const child of folder.children || []) {
    if (isWebLink(child)) out.push(child);
    else if (deep && child.children) out.push(...links(child, true));
  }
  return out;
}

function toItem(b) {
  return { name: cleanTitle(b.title || "") || siteName(b.url), url: b.url };
}

function buildList(tree) {
  list.replaceChildren();
  const walk = (node, depth) => {
    for (const child of node.children || []) {
      if (!child.children) continue; // folders only
      const direct = links(child, false).length;
      const all = links(child, true).length;
      if (all > 0) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "folder";
        b.style.paddingLeft = 12 + depth * 18 + "px";
        const name = document.createElement("span");
        name.textContent = "📁 " + (child.title || "Untitled folder");
        const count = document.createElement("small");
        count.textContent = direct === all ? `${all}` : `${direct} · ${all} with subfolders`;
        b.append(name, count);
        b.addEventListener("click", () => {
          const items = links(child, includeSub.checked).map(toItem);
          if (!items.length) {
            alertDialog("No links directly in that folder", "Tick “Include links in subfolders” to import the ones in its subfolders.");
            return;
          }
          dialog.close();
          importCategory({ name: child.title || "Bookmarks", items });
        });
        list.append(b);
      }
      walk(child, depth + 1);
    }
  };
  walk(tree[0], 0);
  if (!list.children.length) list.textContent = "No bookmark folders with links found.";
}

export async function openBookmarkImport() {
  if (!globalThis.chrome?.bookmarks) {
    alertDialog("Bookmark import isn't available here", "It works when Launchpad runs as the Brave extension.");
    return;
  }
  buildList(await chrome.bookmarks.getTree());
  dialog.showModal();
}

export function initBookmarkImport() {
  document.querySelectorAll("[data-action='import-bookmarks']").forEach((b) => {
    b.addEventListener("click", openBookmarkImport);
  });
  document.getElementById("bookmarkCancel").addEventListener("click", () => dialog.close());
}
