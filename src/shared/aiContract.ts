// Everything about the AI request/response contract that doesn't touch the network:
// the prompt, the compact layer outline, the JSON schema, and response validation.

import { checkProposedName } from "./names";
import type { RuleResult } from "./rules";
import type { Confidence, LayerContext, RootScan } from "./types";

/** Layers of one root described to the model (context), and candidates per request. */
export const MAX_OUTLINE_LAYERS = 500;
export const MAX_CANDIDATES_PER_REQUEST = 120;

export const SYSTEM_PROMPT = `You name layers in Figma designs. You receive an outline of one design (a frame, section, component, or group) and a list of layers whose current names are meaningless defaults such as "Frame 12" or "Rectangle 4". Propose a semantic name for each of those layers so that a designer or developer scanning the layer panel understands what the interface contains.

How to name:
- Describe the layer's purpose in the interface, not its appearance. "Checkout Button", not "Blue Rectangle". "User Avatar", not "Circular Image". "Search Input", not "Rounded Frame".
- Use Title Case, 1-4 words, no punctuation, no quotes, no numbering. Prefer common UI vocabulary: Header, Navigation, Tab Bar, Sidebar, Hero, Card, List, List Item, Row, Button, Icon Button, Input, Search Input, Checkbox, Toggle, Avatar, Image, Icon, Logo, Badge, Tag, Divider, Background, Title, Subtitle, Label, Description, Price, Footer, Modal.
- Read the evidence in this order: text content of the layer and its descendants, component names of instances, the names of parents and siblings that are already meaningful, then structure (auto layout direction, size, fills, image fills, corner radius).
- For text layers, name the role the text plays (Title, Product Name, Price, Error Message). When the text is itself a short action or label, such as a button label, the label itself is a good name ("Add to Cart").
- Give repeated structures the same name (three product cards are all "Product Card"). Do not add numbers to make names unique.
- Containers whose children you renamed should be named for what the group is as a whole ("Product Card", "Billing Address Form").
- A "hint" is a guess from simple heuristics. Use it only if it fits the context.

Confidence:
- "high": the purpose is clear from text, components, or context.
- "medium": a reasonable reading of the structure, but another name could also fit.
- "low": you cannot tell what the layer is for. Still give your best short guess, but mark it low. Do not invent specific meaning (e.g. "Settings Icon") without evidence; use a generic role ("Icon", "Decoration") instead.

Return one suggestion for every layer id listed under "Rename these layers", using the exact ids given. Do not return ids that were not listed.`;

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          proposedName: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["nodeId", "proposedName", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

function quote(s: string, max = 80): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return JSON.stringify(clean.length > max ? clean.slice(0, max - 1) + "…" : clean);
}

function describe(layer: LayerContext): string {
  const parts = [`[${layer.id}] ${layer.type}`];
  parts.push(layer.nameStatus === "generic" ? `(unnamed)` : `name=${quote(layer.name, 60)}`);
  parts.push(`${Math.round(layer.width)}x${Math.round(layer.height)}`);
  if (layer.layoutMode) parts.push(`auto-layout:${layer.layoutMode.toLowerCase()}`);
  if (layer.hasImageFill) parts.push("image-fill");
  else if (layer.hasFill && layer.type !== "TEXT") parts.push("filled");
  if (layer.hasStroke) parts.push("stroked");
  if (layer.cornerRadius) parts.push(`radius:${Math.round(layer.cornerRadius)}`);
  if (!layer.visible) parts.push("hidden");
  if (layer.componentName) parts.push(`component=${quote(layer.componentName, 60)}`);
  if (layer.text !== undefined) parts.push(`text=${quote(layer.text)}`);
  return parts.join(" ");
}

export type AiRequest = {
  rootId: string;
  userPrompt: string;
  candidateIds: string[];
};

/**
 * Build one or more requests for a root. Every request carries the same outline for context,
 * and each marks a different slice of candidates to rename.
 */
export function buildAiRequests(
  root: RootScan,
  candidateIds: string[],
  hints: Map<string, RuleResult>,
): AiRequest[] {
  const outlineLayers = root.layers.slice(0, MAX_OUTLINE_LAYERS);
  const inOutline = new Set(outlineLayers.map((l) => l.id));
  const eligible = candidateIds.filter((id) => inOutline.has(id));
  if (eligible.length === 0) return [];

  const rootDepth = outlineLayers[0]?.depth ?? 0;
  const outline = outlineLayers.map((l) => "  ".repeat(l.depth - rootDepth) + describe(l)).join("\n");
  const byId = new Map(outlineLayers.map((l) => [l.id, l]));

  const requests: AiRequest[] = [];
  for (let i = 0; i < eligible.length; i += MAX_CANDIDATES_PER_REQUEST) {
    const chunk = eligible.slice(i, i + MAX_CANDIDATES_PER_REQUEST);
    const list = chunk
      .map((id) => {
        const hint = hints.get(id);
        const layer = byId.get(id)!;
        return `- ${id} (${layer.type})${hint ? ` hint=${quote(hint.name, 40)}` : ""}`;
      })
      .join("\n");
    const userPrompt =
      `Design: ${quote(root.rootName, 80)} (${root.rootType})\n` +
      (root.truncated || root.layers.length > outlineLayers.length
        ? "Note: the design is large; the outline below is partial.\n"
        : "") +
      `\nOutline (indentation = nesting, [id] TYPE details):\n${outline}\n\n` +
      `Rename these layers:\n${list}`;
    requests.push({ rootId: root.rootId, userPrompt, candidateIds: chunk });
  }
  return requests;
}

export type AiSuggestion = { name: string; confidence: Confidence };
export type AiValidation =
  | { ok: true; suggestions: Map<string, AiSuggestion>; dropped: number }
  | { ok: false; reason: string };

/**
 * Validate a parsed model response. Structural problems reject the whole response;
 * individual unusable names are dropped (those layers fall back to rules / needs review).
 * Only ids that the plugin itself sent can ever come out of here.
 */
export function validateAiResponse(raw: unknown, allowedIds: Iterable<string>): AiValidation {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { suggestions?: unknown }).suggestions)) {
    return { ok: false, reason: "Response did not contain a suggestions list." };
  }
  const allowed = new Set(allowedIds);
  const out = new Map<string, AiSuggestion>();
  let dropped = 0;
  for (const item of (raw as { suggestions: unknown[] }).suggestions) {
    if (typeof item !== "object" || item === null) return { ok: false, reason: "Malformed suggestion entry." };
    const { nodeId, proposedName, confidence } = item as Record<string, unknown>;
    if (typeof nodeId !== "string" || !["high", "medium", "low"].includes(confidence as string)) {
      return { ok: false, reason: "Suggestion is missing a node id or confidence." };
    }
    // Unknown or duplicate ids: possible hallucination. Ignore rather than trust.
    if (!allowed.has(nodeId) || out.has(nodeId)) {
      dropped++;
      continue;
    }
    const check = checkProposedName(proposedName);
    if (!check.ok) {
      dropped++;
      continue;
    }
    out.set(nodeId, { name: check.name, confidence: confidence as Confidence });
  }
  return { ok: true, suggestions: out, dropped };
}
