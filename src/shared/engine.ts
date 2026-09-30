// Naming engine: turns scanned layers into reviewable suggestions.
// Pure functions only — the network call lives in the UI (src/ui/ai.ts).

import type { AiSuggestion } from "./aiContract";
import { applyRules, type LayerLookup, type RuleResult } from "./rules";
import type { RenameSuggestion, RootScan } from "./types";

export type RootPlan = {
  root: RootScan;
  lookup: LayerLookup;
  candidateIds: string[];
  ruleResults: Map<string, RuleResult>;
  /** Candidates the AI should look at (everything without a high-confidence rule result). */
  aiCandidateIds: string[];
};

export type PlanOptions = { includeContentNamedText?: boolean };

export function planRoot(root: RootScan, options: PlanOptions = {}): RootPlan {
  const lookup: LayerLookup = new Map(root.layers.map((l) => [l.id, l]));
  // The root is shown as context but never renamed: the user picked it, so it's theirs.
  const candidates = root.layers
    .slice(1)
    .filter((l) => l.nameStatus === "generic" || (l.nameStatus === "content" && options.includeContentNamedText));
  const ruleResults = new Map<string, RuleResult>();
  for (const layer of candidates) {
    const r = applyRules(layer, lookup);
    if (r) ruleResults.set(layer.id, r);
  }
  return {
    root,
    lookup,
    candidateIds: candidates.map((l) => l.id),
    ruleResults,
    aiCandidateIds: candidates.filter((l) => ruleResults.get(l.id)?.confidence !== "high").map((l) => l.id),
  };
}

/** Merge rules and (optional) AI output. AI wins over non-high rule results. */
export function buildSuggestions(plan: RootPlan, ai?: Map<string, AiSuggestion>): RenameSuggestion[] {
  return plan.candidateIds.map((id) => {
    const layer = plan.lookup.get(id)!;
    const rule = plan.ruleResults.get(id);
    const fromAi = ai?.get(id);
    let proposedName = "";
    let confidence: RenameSuggestion["confidence"] = "low";
    let source: RenameSuggestion["source"] = "none";
    if (rule?.confidence === "high") {
      ({ name: proposedName, confidence } = rule);
      source = "rule";
    } else if (fromAi) {
      ({ name: proposedName, confidence } = fromAi);
      source = "ai";
    } else if (rule) {
      ({ name: proposedName, confidence } = rule);
      source = "rule";
    }
    if (proposedName === layer.name) proposedName = "";
    return {
      nodeId: id,
      rootId: plan.root.rootId,
      type: layer.type,
      depth: layer.depth,
      currentName: layer.name,
      proposedName,
      confidence: proposedName ? confidence : "low",
      source: proposedName ? source : "none",
      // Low confidence = "Needs review": the existing name stays unless the user opts in.
      selected: !!proposedName && confidence !== "low",
      edited: false,
    };
  });
}

export type Summary = { analyzed: number; willRename: number; needsReview: number; preserved: number };

export function summarize(roots: RootScan[], suggestions: RenameSuggestion[]): Summary {
  const analyzed = roots.reduce((n, r) => n + r.layers.length, 0);
  const needsReview = suggestions.filter((s) => !s.proposedName || s.confidence === "low").length;
  return {
    analyzed,
    willRename: suggestions.length - needsReview,
    needsReview,
    preserved: analyzed - suggestions.length,
  };
}
