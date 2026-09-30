// Deterministic naming rules. Cheap, predictable, and usable with no network at all.
// "high" results are final; "medium"/"low" results may be improved by the AI pass.

import { toTitleCase } from "./names";
import type { Confidence, LayerContext } from "./types";

export type RuleResult = { name: string; confidence: Confidence };
export type LayerLookup = Map<string, LayerContext>;

const ACTION_WORDS =
  /^(add|apply|back|book|buy|cancel|close|confirm|continue|create|delete|done|download|edit|finish|follow|get|go|join|learn|log|login|logout|next|open|order|pay|place|previous|register|remove|reset|save|search|see|select|send|share|shop|show|sign|skip|start|submit|subscribe|try|update|upload|view)\b/i;

const PRICE = /^(?:[£$€¥₹]\s?\d[\d,.]*(?:\s?\/\s?\w+)?|\d[\d,.]*\s?(?:[£$€¥₹]|usd|eur|gbp)(?:\s?\/\s?\w+)?)$/i;

const VECTORISH = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE", "ELLIPSE"]);
const ROLE_SUFFIX = /\s+(card|item|row|tile|cell|section|container|wrapper|block|list|group)$/i;

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function children(layer: LayerContext, lookup: LayerLookup): LayerContext[] {
  return layer.childIds.map((id) => lookup.get(id)).filter((c): c is LayerContext => !!c);
}

function descendants(layer: LayerContext, lookup: LayerLookup): LayerContext[] {
  const out: LayerContext[] = [];
  const stack = children(layer, lookup);
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    stack.push(...children(n, lookup));
  }
  return out;
}

/** "Product Card" -> "Product", so a child image becomes "Product Image". */
function parentSubject(layer: LayerContext, lookup: LayerLookup): string | null {
  const parent = layer.parentId ? lookup.get(layer.parentId) : undefined;
  if (!parent || parent.nameStatus !== "intentional") return null;
  const stripped = parent.name.replace(ROLE_SUFFIX, "").trim();
  if (stripped === parent.name.trim() || wordCount(stripped) > 2) return null;
  return toTitleCase(stripped);
}

function withSubject(subject: string | null, role: string): string {
  return subject ? `${subject} ${role}` : role;
}

function isRound(layer: LayerContext): boolean {
  if (layer.type === "ELLIPSE") return true;
  const min = Math.min(layer.width, layer.height);
  return layer.cornerRadius !== undefined && min > 0 && layer.cornerRadius >= min / 2 - 0.5 && Math.abs(layer.width - layer.height) <= 1;
}

export function textRule(text: string): RuleResult | null {
  const t = text.trim();
  if (!t) return null;
  if (PRICE.test(t)) return { name: "Price", confidence: "medium" };
  const words = wordCount(t);
  if (words <= 5 && t.length <= 40) {
    const name = toTitleCase(t);
    if (!/\p{L}/u.test(name)) return null;
    const actionLike = ACTION_WORDS.test(t) || /\?$/.test(t);
    return { name, confidence: actionLike ? "high" : "medium" };
  }
  return { name: "Body Text", confidence: "low" };
}

export function applyRules(layer: LayerContext, lookup: LayerLookup): RuleResult {
  // 1. Component metadata is the strongest signal available.
  if (layer.type === "INSTANCE" && layer.componentName) {
    const family = layer.componentName.split("/")[0].trim();
    if (family) return { name: toTitleCase(family), confidence: "high" };
  }

  // 2. Text content.
  if (layer.type === "TEXT") return (layer.text !== undefined && textRule(layer.text)) || fallbackRule(layer, lookup);

  const kids = children(layer, lookup);
  const minSide = Math.min(layer.width, layer.height);
  const maxSide = Math.max(layer.width, layer.height);

  // 3. Dividers: lines and hairline shapes.
  if (layer.type === "LINE") return { name: "Divider", confidence: "high" };
  if (kids.length === 0 && ["RECTANGLE", "FRAME"].includes(layer.type) && minSide <= 2 && maxSide >= 16) {
    return { name: "Divider", confidence: "high" };
  }

  // 4. Image fills.
  if (layer.hasImageFill && kids.length === 0) {
    if (isRound(layer)) return { name: withSubject(parentSubject(layer, lookup), "Avatar"), confidence: "medium" };
    return { name: withSubject(parentSubject(layer, lookup), "Image"), confidence: "medium" };
  }

  // 5. Background: a leaf shape filling its parent, at the bottom of the stack.
  const parent = layer.parentId ? lookup.get(layer.parentId) : undefined;
  if (
    parent &&
    kids.length === 0 &&
    ["RECTANGLE", "FRAME"].includes(layer.type) &&
    parent.childIds[0] === layer.id &&
    parent.childIds.length > 1 &&
    Math.abs(layer.width - parent.width) <= 1 &&
    Math.abs(layer.height - parent.height) <= 1
  ) {
    return { name: "Background", confidence: "medium" };
  }

  // 6. Icons: small vector shapes, or small containers made only of vectors.
  if (VECTORISH.has(layer.type) && layer.type !== "ELLIPSE" && maxSide <= 48 && kids.length === 0) {
    return { name: "Icon", confidence: "low" };
  }
  if (["FRAME", "GROUP"].includes(layer.type) && maxSide <= 48 && kids.length > 0) {
    const all = descendants(layer, lookup);
    if (all.every((d) => VECTORISH.has(d.type) || ((d.type === "GROUP" || d.type === "FRAME") && d.childIds.length > 0))) {
      return { name: "Icon", confidence: "medium" };
    }
  }

  // 7. Buttons and inputs: a styled box around one short label.
  if (layer.type === "FRAME" && (layer.hasFill || layer.hasStroke)) {
    const texts = kids.filter((k) => k.type === "TEXT" && k.text);
    const others = kids.filter((k) => k.type !== "TEXT");
    const onlyIconsBesideText = others.every((k) => Math.max(k.width, k.height) <= 32);
    if (texts.length === 1 && onlyIconsBesideText && layer.height <= 72) {
      const label = texts[0].text!.trim();
      const search = /^search\b/i.test(label);
      const placeholder = /^(enter|type|your)\b/i.test(label) || /\.\.\.|…$/.test(label);
      if (search) return { name: "Search Input", confidence: "medium" };
      if (placeholder && layer.hasStroke) {
        const subject = toTitleCase(label.replace(/^(enter|type)\s+(your\s+)?|^your\s+/i, "").replace(/(\.\.\.|…)$/, ""));
        if (subject && wordCount(subject) <= 3) return { name: `${subject} Input`, confidence: "low" };
      }
      if (wordCount(label) <= 4 && (layer.cornerRadius ?? 0) > 0 && layer.layoutMode) {
        const title = toTitleCase(label);
        if (title) return { name: /\bbutton$/i.test(title) ? title : `${title} Button`, confidence: "medium" };
      }
    }
  }

  return fallbackRule(layer, lookup);
}

const CONTAINERS = new Set(["FRAME", "GROUP", "SECTION", "COMPONENT", "COMPONENT_SET"]);

/** First short, readable text inside a container: usually its heading or label. */
function leadingText(layer: LayerContext, lookup: LayerLookup): string | null {
  const stack = [...children(layer, lookup)].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "TEXT" && n.text) {
      const t = n.text.trim();
      if (wordCount(t) <= 4 && t.length <= 32 && !PRICE.test(t) && /\p{L}/u.test(t)) return toTitleCase(t);
    }
    stack.push(...[...children(n, lookup)].reverse());
  }
  return null;
}

/**
 * Last resort, so every candidate gets a suggestion the user can accept with one tick.
 * Always "low" confidence: it lands in Needs review and the AI pass (if on) can replace it.
 */
function fallbackRule(layer: LayerContext, lookup: LayerLookup): RuleResult {
  const low = (name: string): RuleResult => ({ name, confidence: "low" });
  const maxSide = Math.max(layer.width, layer.height);

  if (CONTAINERS.has(layer.type)) {
    const subject = leadingText(layer, lookup);
    const styled = layer.hasFill || layer.hasStroke;
    let role: string;
    if (styled && (layer.cornerRadius ?? 0) > 0) role = layer.height <= 56 ? "Button" : "Card";
    else if (layer.layoutMode === "HORIZONTAL") role = "Row";
    else if (layer.layoutMode === "VERTICAL") role = "Column";
    else role = layer.width >= 300 && layer.height >= 200 ? "Section" : "Container";
    if (subject) return low(new RegExp(`\\b${role}$`, "i").test(subject) ? subject : `${subject} ${role}`);
    // Bare "Section" is itself a Figma default name, so an untitled section needs a qualifier.
    return low(role === "Section" ? "Content Area" : role);
  }

  switch (layer.type) {
    case "ELLIPSE":
      if (maxSide <= 12) return low("Status Dot");
      return low(layer.hasStroke && !layer.hasFill ? "Ring" : "Circle");
    case "RECTANGLE":
      return low(layer.parentId && lookup.get(layer.parentId)?.childIds[0] === layer.id ? "Background" : "Shape");
    case "VECTOR":
    case "BOOLEAN_OPERATION":
    case "STAR":
    case "POLYGON":
      return low(maxSide > 48 ? "Illustration" : "Icon");
    case "TEXT":
      return low("Text Label");
    case "INSTANCE":
      return low("Component Instance");
    default:
      return low("Element");
  }
}
