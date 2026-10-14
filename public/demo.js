// Live demo: runs the real Nomen plugin UI (plugin/ui.html) in an iframe and stands in for
// Figma's main thread with a sample design, so visitors can try it without Figma.

const frame = document.getElementById("plugin");
let settings = { apiKey: null, includeContentNamedText: false };
let scenario = "checkout";

const L = (id, type, name, extra = {}, children = []) => ({ id, type, name, extra, children });

const designs = {
  checkout: L("1:1", "FRAME", "Checkout Page", { width: 390, height: 844 }, [
    L("1:2", "FRAME", "Frame 12", { width: 390, height: 64, layoutMode: "HORIZONTAL" }, [
      L("1:3", "TEXT", "Text 14", { text: "Checkout" }),
      L("1:4", "FRAME", "Frame 15", { width: 24, height: 24 }, [L("1:5", "VECTOR", "Vector 17", { width: 16, height: 16 })]),
      L("1:6", "RECTANGLE", "Rectangle 18", { width: 390, height: 1, hasFill: true }),
    ]),
    L("1:7", "FRAME", "Product Card", { width: 358, height: 120, layoutMode: "HORIZONTAL" }, [
      L("1:8", "RECTANGLE", "Rectangle 21", { width: 96, height: 96, hasFill: true, hasImageFill: true, cornerRadius: 8 }),
      L("1:9", "TEXT", "Text 22", { text: "Nike Air Max 90" }),
      L("1:10", "TEXT", "Text 23", { text: "£120.00" }),
    ]),
    L("1:11", "FRAME", "Frame 30", { width: 358, height: 48, hasStroke: true, cornerRadius: 8, layoutMode: "HORIZONTAL" }, [
      L("1:12", "TEXT", "Text 31", { text: "Search products" }),
    ]),
    L("1:13", "ELLIPSE", "Ellipse 3", { width: 8, height: 8, hasFill: true }),
    L("1:14", "INSTANCE", "Frame 44", { componentName: "Button / Primary / Default", width: 358, height: 52 }),
    L("1:15", "FRAME", "Frame 50", { width: 358, height: 52, hasFill: true, cornerRadius: 12, layoutMode: "HORIZONTAL" }, [
      L("1:16", "TEXT", "Place order", { text: "Place order" }),
    ]),
    L("1:17", "GROUP", "Group 52", { width: 200, height: 60 }, [
      L("1:18", "TEXT", "Text 60", { text: "By placing your order you agree to our terms of service and privacy policy." }),
    ]),
  ]),
  wallet: L("2:1", "FRAME", "Wallet Home", { width: 390, height: 844 }, [
    L("2:2", "FRAME", "Frame 9", { width: 170, height: 120, hasFill: true, cornerRadius: 12 }, [
      L("2:3", "TEXT", "Text 3", { text: "Pay someone" }),
      L("2:4", "TEXT", "Text 4", { text: "Pay for purchases or a service you received." }),
    ]),
    L("2:5", "FRAME", "Frame 1", { width: 358, height: 40, layoutMode: "HORIZONTAL" }, [
      L("2:6", "ELLIPSE", "Ellipse 1", { width: 40, height: 40, hasFill: true, hasImageFill: true }),
      L("2:7", "TEXT", "Text 8", { text: "Hi, Ama" }),
    ]),
    L("2:8", "ELLIPSE", "Ellipse 5", { width: 8, height: 8, hasFill: true }),
    L("2:9", "LINE", "Line 2", { width: 358, height: 0 }),
    L("2:10", "FRAME", "Frame 2", { width: 358, height: 400 }),
  ]),
};

const status = (name, type, text) => {
  if (/^(Frame|Group|Rectangle|Ellipse|Vector|Text|Line)(\s+\d+)?$/i.test(name)) return "generic";
  if (type === "TEXT" && text && name.toLowerCase() === text.toLowerCase()) return "content";
  return "intentional";
};

function flatten(node, depth = 0, parentId, out = []) {
  const e = node.extra;
  out.push({
    id: node.id, type: node.type, name: node.name, nameStatus: status(node.name, node.type, e.text), depth, parentId,
    childIds: node.children.map((c) => c.id), text: e.text, componentName: e.componentName,
    width: e.width ?? 120, height: e.height ?? 20, layoutMode: e.layoutMode, hasFill: !!e.hasFill,
    hasImageFill: !!e.hasImageFill, hasStroke: !!e.hasStroke, cornerRadius: e.cornerRadius, visible: true,
  });
  node.children.forEach((c) => flatten(c, depth + 1, node.id, out));
  return out;
}

const roots = () => (scenario === "both" ? [designs.checkout, designs.wallet] : [designs[scenario]]);
const post = (msg) => frame.contentWindow.postMessage({ pluginMessage: msg }, "*");

function sendSelection() {
  const layers = roots().flatMap((r) => flatten(r));
  post({
    type: "selection",
    roots: roots().map((r) => ({ id: r.id, name: r.name, type: r.type })),
    layerCount: layers.length,
    genericCount: layers.filter((l) => l.nameStatus === "generic" && l.depth > 0).length,
  });
}

// ---------- Layers panel (mirrors Figma's, shows renames as they happen) ----------

const layersEl = document.getElementById("layers");
const fileTitleEl = document.getElementById("file-title");
const canvasEl = document.getElementById("canvas");
/** Names applied by the plugin in this run: id -> new name. Cleared on every restart. */
const renamed = new Map();

const GLYPHS = {
  FRAME: '<path d="M5 2v12M11 2v12M2 5h12M2 11h12"/>',
  GROUP: '<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke-dasharray="2 1.6"/>',
  TEXT: '<path d="M3.5 3.5h9M8 3.5v9"/>',
  RECTANGLE: '<rect x="3" y="3" width="10" height="10" rx="0.5"/>',
  ELLIPSE: '<circle cx="8" cy="8" r="5"/>',
  LINE: '<path d="M3 13 13 3"/>',
  VECTOR: '<path d="M3 13c1-5 5-9 10-10"/>',
  INSTANCE: '<path d="M8 2 14 8l-6 6-6-6 6-6Z"/>',
};
const glyph = (type) =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[type] ?? GLYPHS.RECTANGLE}</svg>`;

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function renderLayers() {
  const rows = [];
  const walk = (node, depth) => {
    const name = renamed.get(node.id) ?? node.name;
    const cls = renamed.has(node.id) ? "layer renamed" : "layer";
    rows.push(
      `<li class="${cls}" data-id="${node.id}" style="--depth:${depth}">${glyph(node.type)}<span>${escapeHtml(name)}</span></li>`,
    );
    node.children.forEach((c) => walk(c, depth + 1));
  };
  roots().forEach((r) => walk(r, 0));
  layersEl.innerHTML = rows.join("");
  fileTitleEl.textContent = roots().map((r) => r.name).join(" + ");
  canvasEl.dataset.screens = String(roots().length);
  canvasEl.querySelectorAll(".artboard-label").forEach((el, i) => (el.textContent = roots()[i]?.name ?? ""));
}

function highlight(nodeId) {
  layersEl.querySelectorAll(".layer.focus").forEach((el) => el.classList.remove("focus"));
  const row = layersEl.querySelector(`[data-id="${CSS.escape(nodeId)}"]`);
  if (!row) return;
  row.classList.add("focus");
  row.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** Start the demo over on the current design, with its original messy layer names. */
function restart() {
  renamed.clear();
  renderLayers();
  // A unique URL guarantees a real reload, never a cached or skipped one.
  frame.src = `plugin/ui.html?run=${Date.now()}`;
}

function handshake() {
  post({ type: "settings", settings });
  sendSelection();
}

// Belt and braces: hand the plugin its selection whenever it loads, even if its own
// "ready" message was missed, so the panel can never sit blank.
frame.addEventListener("load", () => setTimeout(handshake, 50));

window.addEventListener("message", (e) => {
  const msg = e.data?.pluginMessage;
  if (!msg) return;
  switch (msg.type) {
    case "ui-ready":
      handshake();
      break;
    // "Analyze Another" after a rename: loop back to the untouched design.
    case "refresh-selection":
      restart();
      break;
    case "scan":
      setTimeout(() => post({ type: "scan-result", roots: roots().map((r) => ({ rootId: r.id, rootName: r.name, rootType: r.type, layers: flatten(r), truncated: false })) }), 500);
      break;
    case "apply":
      msg.changes.forEach((c) => renamed.set(c.nodeId, c.name));
      renderLayers();
      setTimeout(() => post({ type: "apply-result", renamed: msg.changes.length, skipped: [] }), 250);
      break;
    case "focus-node":
      highlight(msg.nodeId);
      break;
    case "save-settings":
      settings = { ...settings, ...msg.settings };
      post({ type: "settings", settings });
      break;
    case "close":
      restart();
      break;
  }
});

document.querySelectorAll("[data-design]").forEach((btn) =>
  btn.addEventListener("click", () => {
    scenario = btn.dataset.design;
    document.querySelectorAll("[data-design]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    restart();
  }),
);

renderLayers();

// The plugin panel may have finished loading before this script ran, in which case its
// "ready" message and load event were missed. Hand it the design now; if it isn't ready
// yet, its own "ready" message (or its retry) will arrive and trigger the handshake again.
if (frame.contentDocument?.readyState === "complete") handshake();
