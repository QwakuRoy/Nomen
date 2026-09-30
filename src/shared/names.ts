import type { NameStatus } from "./types";

export const MAX_NAME_LENGTH = 60;

/** Default names Figma gives new layers (English UI). */
const DEFAULT_LAYER_WORDS = [
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
  "Layer",
];

// "Frame", "Frame 12", "Frame 12 copy", "Frame 12 copy 3", "Frame 12 (1)", "rectangle-4"
const GENERIC_NAME = new RegExp(
  `^(?:${DEFAULT_LAYER_WORDS.join("|")})(?:[\\s_-]*\\d+)?(?:\\s+copy(?:\\s+\\d+)?)?(?:\\s*\\(\\d+\\))?$`,
  "i",
);

export function isGenericName(name: string): boolean {
  return GENERIC_NAME.test(name.trim());
}

function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function classifyName(name: string, type: string, text?: string): NameStatus {
  if (isGenericName(name) || name.trim() === "") return "generic";
  if (type === "TEXT" && text !== undefined) {
    const n = normalizeForCompare(name);
    const t = normalizeForCompare(text);
    // Figma truncates long auto-names, so a prefix match also counts.
    if (n.length > 0 && (n === t || (n.length >= 20 && t.startsWith(n)))) return "content";
  }
  return "intentional";
}

const MINOR_WORDS = new Set(["a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "for", "at", "by", "with", "per", "vs"]);

/** "add to cart" -> "Add to Cart", "Forgot password?" -> "Forgot Password". */
export function toTitleCase(input: string): string {
  const words = input
    .replace(/[^\p{L}\p{N}&'’\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((w, i) => {
      // Keep acronyms / mixed-case brand words (e.g. "FAQ", "iPhone") as typed.
      if (/[A-Z]/.test(w.slice(1)) || /^[A-Z0-9]{2,}$/.test(w)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && i < words.length - 1 && MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Strip control characters and collapse whitespace. Never adds content. */
export function sanitizeName(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** Validate a name before it is allowed anywhere near the Figma document. */
export function checkProposedName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, reason: "not a string" };
  const name = sanitizeName(raw);
  if (!name) return { ok: false, reason: "empty" };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: "too long" };
  if (!/\p{L}/u.test(name)) return { ok: false, reason: "no letters" };
  if (isGenericName(name)) return { ok: false, reason: "still generic" };
  if (/[{}<>`]/.test(name) || /^["']|["']$/.test(name)) return { ok: false, reason: "unexpected formatting" };
  return { ok: true, name };
}
