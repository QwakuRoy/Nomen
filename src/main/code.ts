// Plugin controller (Figma main thread): reads the selection, extracts layer context,
// and applies approved renames. It never decides names itself.

import { checkProposedName, classifyName } from "../shared/names";
import type { LayerContext, MainToUi, RenameChange, RootInfo, RootScan, Settings, SkipReason, UiToMain } from "../shared/types";

/** Hard cap on layers analyzed in one operation (across all selected roots). */
const MAX_LAYERS = 2000;
const TEXT_LIMIT = 200;
const UNSUPPORTED_ROOTS = new Set(["INSTANCE", "BOOLEAN_OPERATION"]);

/** IDs and names captured at analysis time; apply only ever touches these nodes. */
let analyzed = new Map<string, string>();
let lastRootIds: string[] = [];

figma.showUI(__html__, { width: 380, height: 600, themeColors: true, title: "Nomen" });

function post(msg: MainToUi) {
  figma.ui.postMessage(msg);
}

// ---------- Selection ----------

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return "children" in node;
}

/** Selected nodes, minus any that are nested inside another selected node. */
function topLevelSelection(): SceneNode[] {
  const selection = figma.currentPage.selection;
  const ids = new Set(selection.map((n) => n.id));
  return selection.filter((node) => {
    for (let p = node.parent; p && p.type !== "PAGE"; p = p.parent) if (ids.has(p.id)) return false;
    return true;
  });
}

function describeSelection(): Extract<MainToUi, { type: "selection" }> {
  const nodes = topLevelSelection();
  if (nodes.length === 0) {
    return { type: "selection", roots: [], layerCount: 0, genericCount: 0, problem: "Select a frame, group, section, or component to analyze." };
  }
  const roots = nodes.filter((n) => hasChildren(n) && !UNSUPPORTED_ROOTS.has(n.type));
  if (roots.length === 0) {
    const n = nodes[0];
    const problem =
      n.type === "INSTANCE"
        ? `"${n.name}" is a component instance. Its layers come from the main component — select the main component, or a frame that contains this instance.`
        : `"${n.name}" is a single ${n.type.toLowerCase().replace(/_/g, " ")} layer with nothing inside it. Select the frame, group, or section that contains it.`;
    return { type: "selection", roots: [], layerCount: 0, genericCount: 0, problem };
  }
  let layerCount = 0;
  let genericCount = 0;
  const walk = (node: SceneNode, isRoot: boolean) => {
    if (layerCount >= MAX_LAYERS) return;
    layerCount++;
    if (!isRoot && classifyName(node.name, node.type) === "generic") genericCount++;
    if (hasChildren(node) && node.type !== "INSTANCE") for (const c of node.children) walk(c, false);
  };
  roots.forEach((r) => walk(r, true));
  const info: RootInfo[] = roots.map((r) => ({ id: r.id, name: r.name, type: r.type }));
  return { type: "selection", roots: info, layerCount, genericCount };
}

// ---------- Context extraction ----------

function paints(node: SceneNode, key: "fills" | "strokes"): readonly Paint[] {
  const value = (node as unknown as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as Paint[]) : [];
}

async function componentNameOf(node: InstanceNode): Promise<string | undefined> {
  try {
    const main = await node.getMainComponentAsync();
    if (!main) return undefined;
    // Variants are named "State=Default, Size=Large"; the family name lives on the set.
    return main.parent?.type === "COMPONENT_SET" ? main.parent.name : main.name;
  } catch {
    return undefined;
  }
}

async function toContext(node: SceneNode, depth: number, parentId: string | undefined): Promise<LayerContext> {
  const text = node.type === "TEXT" ? node.characters.slice(0, TEXT_LIMIT) : undefined;
  const fills = paints(node, "fills").filter((p) => p.visible !== false);
  const strokes = paints(node, "strokes").filter((p) => p.visible !== false);
  const radius = "cornerRadius" in node && typeof node.cornerRadius === "number" ? node.cornerRadius : undefined;
  const layoutMode = "layoutMode" in node && node.layoutMode !== "NONE" ? node.layoutMode : undefined;
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
    componentName: node.type === "INSTANCE" ? await componentNameOf(node) : undefined,
    width: node.width,
    height: node.height,
    layoutMode,
    hasFill: fills.length > 0,
    hasImageFill: fills.some((p) => p.type === "IMAGE"),
    hasStroke: strokes.length > 0,
    cornerRadius: radius || undefined,
    visible: node.visible,
  };
}

async function scan(): Promise<RootScan[]> {
  const roots = topLevelSelection().filter((n) => hasChildren(n) && !UNSUPPORTED_ROOTS.has(n.type));
  const results: RootScan[] = [];
  let budget = MAX_LAYERS;
  for (const root of roots) {
    const layers: LayerContext[] = [];
    let truncated = false;
    const stack: { node: SceneNode; depth: number; parentId?: string }[] = [{ node: root, depth: 0 }];
    while (stack.length) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      const { node, depth, parentId } = stack.pop()!;
      const ctx = await toContext(node, depth, parentId);
      layers.push(ctx);
      budget--;
      if (hasChildren(node) && node.type !== "INSTANCE") {
        // Push in reverse so children come out in layer-panel order (depth-first).
        for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], depth: depth + 1, parentId: node.id });
      }
    }
    results.push({ rootId: root.id, rootName: root.name, rootType: root.type, layers, truncated });
  }
  analyzed = new Map(results.flatMap((r) => r.layers.map((l) => [l.id, l.name] as [string, string])));
  lastRootIds = results.map((r) => r.rootId);
  return results;
}

// ---------- Apply ----------

async function apply(changes: RenameChange[]) {
  const skipped: { nodeId: string; name: string; reason: SkipReason }[] = [];
  const ready: { node: SceneNode; name: string }[] = [];

  // Resolve and validate everything first, so we never stop half-way through mutating.
  for (const change of changes) {
    const skip = (reason: SkipReason) => skipped.push({ nodeId: change.nodeId, name: change.expectedCurrentName, reason });
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
      // Someone renamed it while the preview was open. Their name wins.
      skip("renamed-since-analysis");
      continue;
    }
    ready.push({ node: node as SceneNode, name: check.name });
  }

  let renamed = 0;
  for (const { node, name } of ready) {
    try {
      node.name = name;
      analyzed.set(node.id, name);
      renamed++;
    } catch {
      skipped.push({ nodeId: node.id, name: node.name, reason: "error" });
    }
  }
  // One undo step for the whole operation.
  if (renamed > 0) figma.commitUndo();
  post({ type: "apply-result", renamed, skipped });
}

// ---------- Settings ----------

async function loadSettings(): Promise<Settings> {
  const [apiKey, includeContentNamedText] = await Promise.all([
    figma.clientStorage.getAsync("apiKey"),
    figma.clientStorage.getAsync("includeContentNamedText"),
  ]);
  return { apiKey: typeof apiKey === "string" && apiKey ? apiKey : null, includeContentNamedText: includeContentNamedText === true };
}

async function saveSettings(patch: Partial<Settings>) {
  if ("apiKey" in patch) {
    if (patch.apiKey) await figma.clientStorage.setAsync("apiKey", patch.apiKey);
    else await figma.clientStorage.deleteAsync("apiKey");
  }
  if ("includeContentNamedText" in patch) await figma.clientStorage.setAsync("includeContentNamedText", !!patch.includeContentNamedText);
  post({ type: "settings", settings: await loadSettings() });
}

// ---------- Wiring ----------

figma.on("selectionchange", () => post(describeSelection()));

figma.ui.onmessage = async (msg: UiToMain) => {
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
        figma.currentPage.selection = [node as SceneNode];
        figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
      }
      break;
    }
    case "restore-selection": {
      const nodes = (await Promise.all(lastRootIds.map((id) => figma.getNodeByIdAsync(id)))).filter(
        (n): n is SceneNode => !!n && !n.removed && "visible" in n,
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
