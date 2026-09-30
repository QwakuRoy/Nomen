"use strict";
(() => {
  // src/shared/names.ts
  var MAX_NAME_LENGTH = 60;
  var DEFAULT_LAYER_WORDS = [
    "Frame",
    "Group",
    "Section",
    "Rectangle",
    "Ellipse",
    "Line",
    "Arrow",
    "Polygon",
    "Star",
    "Vector",
    "Text",
    "Image",
    "Slice",
    "Component",
    "Instance",
    "Union",
    "Subtract",
    "Intersect",
    "Exclude",
    "Boolean",
    "Auto layout",
    "Layer"
  ];
  var GENERIC_NAME = new RegExp(
    `^(?:${DEFAULT_LAYER_WORDS.join("|")})(?:[\\s_-]*\\d+)?(?:\\s+copy(?:\\s+\\d+)?)?(?:\\s*\\(\\d+\\))?$`,
    "i"
  );
  function isGenericName(name) {
    return GENERIC_NAME.test(name.trim());
  }
  function normalizeForCompare(s) {
    return s.replace(/\s+/g, " ").trim().toLowerCase();
  }
  function classifyName(name, type, text) {
    if (isGenericName(name) || name.trim() === "") return "generic";
    if (type === "TEXT" && text !== void 0) {
      const n = normalizeForCompare(name);
      const t = normalizeForCompare(text);
      if (n.length > 0 && (n === t || n.length >= 20 && t.startsWith(n))) return "content";
    }
    return "intentional";
  }
  function sanitizeName(input) {
    return input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  }
  function checkProposedName(raw) {
    if (typeof raw !== "string") return { ok: false, reason: "not a string" };
    const name = sanitizeName(raw);
    if (!name) return { ok: false, reason: "empty" };
    if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: "too long" };
    if (!new RegExp("\\p{L}", "u").test(name)) return { ok: false, reason: "no letters" };
    if (isGenericName(name)) return { ok: false, reason: "still generic" };
    if (/[{}<>`]/.test(name) || /^["']|["']$/.test(name)) return { ok: false, reason: "unexpected formatting" };
    return { ok: true, name };
  }

  // src/main/code.ts
  var MAX_LAYERS = 2e3;
  var TEXT_LIMIT = 200;
  var UNSUPPORTED_ROOTS = /* @__PURE__ */ new Set(["INSTANCE", "BOOLEAN_OPERATION"]);
  var analyzed = /* @__PURE__ */ new Map();
  var lastRootIds = [];
  figma.showUI(__html__, { width: 380, height: 600, themeColors: true, title: "Nomen" });
  function post(msg) {
    figma.ui.postMessage(msg);
  }
  function hasChildren(node) {
    return "children" in node;
  }
  function topLevelSelection() {
    const selection = figma.currentPage.selection;
    const ids = new Set(selection.map((n) => n.id));
    return selection.filter((node) => {
      for (let p = node.parent; p && p.type !== "PAGE"; p = p.parent) if (ids.has(p.id)) return false;
      return true;
    });
  }
  function describeSelection() {
    const nodes = topLevelSelection();
    if (nodes.length === 0) {
      return { type: "selection", roots: [], layerCount: 0, genericCount: 0, problem: "Select a frame, group, section, or component to analyze." };
    }
    const roots = nodes.filter((n) => hasChildren(n) && !UNSUPPORTED_ROOTS.has(n.type));
    if (roots.length === 0) {
      const n = nodes[0];
      const problem = n.type === "INSTANCE" ? `"${n.name}" is a component instance. Its layers come from the main component \u2014 select the main component, or a frame that contains this instance.` : `"${n.name}" is a single ${n.type.toLowerCase().replace(/_/g, " ")} layer with nothing inside it. Select the frame, group, or section that contains it.`;
      return { type: "selection", roots: [], layerCount: 0, genericCount: 0, problem };
    }
    let layerCount = 0;
    let genericCount = 0;
    const walk = (node, isRoot) => {
      if (layerCount >= MAX_LAYERS) return;
      layerCount++;
      if (!isRoot && classifyName(node.name, node.type) === "generic") genericCount++;
      if (hasChildren(node) && node.type !== "INSTANCE") for (const c of node.children) walk(c, false);
    };
    roots.forEach((r) => walk(r, true));
    const info = roots.map((r) => ({ id: r.id, name: r.name, type: r.type }));
    return { type: "selection", roots: info, layerCount, genericCount };
  }
  function paints(node, key) {
    const value = node[key];
    return Array.isArray(value) ? value : [];
  }
  async function componentNameOf(node) {
    var _a;
    try {
      const main = await node.getMainComponentAsync();
      if (!main) return void 0;
      return ((_a = main.parent) == null ? void 0 : _a.type) === "COMPONENT_SET" ? main.parent.name : main.name;
    } catch (e) {
      return void 0;
    }
  }
  async function toContext(node, depth, parentId) {
    const text = node.type === "TEXT" ? node.characters.slice(0, TEXT_LIMIT) : void 0;
    const fills = paints(node, "fills").filter((p) => p.visible !== false);
    const strokes = paints(node, "strokes").filter((p) => p.visible !== false);
    const radius = "cornerRadius" in node && typeof node.cornerRadius === "number" ? node.cornerRadius : void 0;
    const layoutMode = "layoutMode" in node && node.layoutMode !== "NONE" ? node.layoutMode : void 0;
    return {
      id: node.id,
      type: node.type,
      name: node.name,
      nameStatus: classifyName(node.name, node.type, text),
      depth,
      parentId,
      // Don't descend into instances: their internals belong to the main component.
      childIds: hasChildren(node) && node.type !== "INSTANCE" ? node.children.map((c) => c.id) : [],
      text,
      componentName: node.type === "INSTANCE" ? await componentNameOf(node) : void 0,
      width: node.width,
      height: node.height,
      layoutMode,
      hasFill: fills.length > 0,
      hasImageFill: fills.some((p) => p.type === "IMAGE"),
      hasStroke: strokes.length > 0,
      cornerRadius: radius || void 0,
      visible: node.visible
    };
  }
  async function scan() {
    const roots = topLevelSelection().filter((n) => hasChildren(n) && !UNSUPPORTED_ROOTS.has(n.type));
    const results = [];
    let budget = MAX_LAYERS;
    for (const root of roots) {
      const layers = [];
      let truncated = false;
      const stack = [{ node: root, depth: 0 }];
      while (stack.length) {
        if (budget <= 0) {
          truncated = true;
          break;
        }
        const { node, depth, parentId } = stack.pop();
        const ctx = await toContext(node, depth, parentId);
        layers.push(ctx);
        budget--;
        if (hasChildren(node) && node.type !== "INSTANCE") {
          for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], depth: depth + 1, parentId: node.id });
        }
      }
      results.push({ rootId: root.id, rootName: root.name, rootType: root.type, layers, truncated });
    }
    analyzed = new Map(results.flatMap((r) => r.layers.map((l) => [l.id, l.name])));
    lastRootIds = results.map((r) => r.rootId);
    return results;
  }
  async function apply(changes) {
    const skipped = [];
    const ready = [];
    for (const change of changes) {
      const skip = (reason) => skipped.push({ nodeId: change.nodeId, name: change.expectedCurrentName, reason });
      if (!analyzed.has(change.nodeId)) {
        skip("not-analyzed");
        continue;
      }
      const check = checkProposedName(change.name);
      if (!check.ok) {
        skip("invalid-name");
        continue;
      }
      const node = await figma.getNodeByIdAsync(change.nodeId);
      if (!node || node.removed || node.type === "PAGE" || node.type === "DOCUMENT") {
        skip("deleted");
        continue;
      }
      if (node.name !== change.expectedCurrentName) {
        skip("renamed-since-analysis");
        continue;
      }
      ready.push({ node, name: check.name });
    }
    let renamed = 0;
    for (const { node, name } of ready) {
      try {
        node.name = name;
        analyzed.set(node.id, name);
        renamed++;
      } catch (e) {
        skipped.push({ nodeId: node.id, name: node.name, reason: "error" });
      }
    }
    if (renamed > 0) figma.commitUndo();
    post({ type: "apply-result", renamed, skipped });
  }
  async function loadSettings() {
    const [apiKey, includeContentNamedText] = await Promise.all([
      figma.clientStorage.getAsync("apiKey"),
      figma.clientStorage.getAsync("includeContentNamedText")
    ]);
    return { apiKey: typeof apiKey === "string" && apiKey ? apiKey : null, includeContentNamedText: includeContentNamedText === true };
  }
  async function saveSettings(patch) {
    if ("apiKey" in patch) {
      if (patch.apiKey) await figma.clientStorage.setAsync("apiKey", patch.apiKey);
      else await figma.clientStorage.deleteAsync("apiKey");
    }
    if ("includeContentNamedText" in patch) await figma.clientStorage.setAsync("includeContentNamedText", !!patch.includeContentNamedText);
    post({ type: "settings", settings: await loadSettings() });
  }
  figma.on("selectionchange", () => post(describeSelection()));
  figma.ui.onmessage = async (msg) => {
    switch (msg.type) {
      case "ui-ready":
        post({ type: "settings", settings: await loadSettings() });
        post(describeSelection());
        break;
      case "scan":
        try {
          post({ type: "scan-result", roots: await scan() });
        } catch (e) {
          post({ type: "scan-error", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      case "apply":
        await apply(msg.changes);
        break;
      case "focus-node": {
        const node = await figma.getNodeByIdAsync(msg.nodeId);
        if (node && !node.removed && "visible" in node) {
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
        }
        break;
      }
      case "restore-selection": {
        const nodes = (await Promise.all(lastRootIds.map((id) => figma.getNodeByIdAsync(id)))).filter(
          (n) => !!n && !n.removed && "visible" in n
        );
        if (nodes.length) figma.currentPage.selection = nodes;
        break;
      }
      case "refresh-selection":
        post(describeSelection());
        break;
      case "save-settings":
        await saveSettings(msg.settings);
        break;
      case "notify":
        figma.notify(msg.message, { error: msg.error });
        break;
      case "close":
        figma.closePlugin();
        break;
    }
  };
})();
