import { describe, expect, it } from "vitest";
import { buildAiRequests, validateAiResponse } from "../src/shared/aiContract";
import { buildSuggestions, planRoot, summarize } from "../src/shared/engine";
import { checkProposedName } from "../src/shared/names";
import { productCard, tree } from "./fixtures";

const byId = (s: ReturnType<typeof buildSuggestions>) => Object.fromEntries(s.map((x) => [x.nodeId, x]));

describe("rules only (no AI)", () => {
  const scan = productCard();
  const plan = planRoot(scan);
  const s = byId(buildSuggestions(plan));

  it("never touches the root or intentional names", () => {
    expect(s["1:1"]).toBeUndefined(); // root
    expect(s["1:2"]).toBeUndefined(); // "Product Card"
    expect(s["1:7"]).toBeUndefined(); // content-named text is preserved by default
  });

  it("names things it can be sure about", () => {
    expect(s["1:3"]).toMatchObject({ proposedName: "Product Image", selected: true }); // image fill + parent subject
    expect(s["1:5"]).toMatchObject({ proposedName: "Price", selected: true });
    expect(s["1:6"]).toMatchObject({ proposedName: "Add to Cart Button", selected: true });
    expect(s["1:8"]).toMatchObject({ proposedName: "Divider", confidence: "high" });
    expect(s["1:10"]).toMatchObject({ proposedName: "Button", confidence: "high" }); // component metadata
  });

  it("marks weak guesses for review and leaves them unselected", () => {
    expect(s["1:9"]).toMatchObject({ proposedName: "Icon", confidence: "low", selected: false });
  });

  it("summarizes will-rename / review / preserved", () => {
    const sum = summarize([scan], buildSuggestions(plan));
    expect(sum).toEqual({ analyzed: 10, willRename: 6, needsReview: 1, preserved: 3 });
  });
});

describe("AI merge", () => {
  const scan = productCard();
  const plan = planRoot(scan);

  it("does not send high-confidence rule results to the AI", () => {
    expect(plan.aiCandidateIds).not.toContain("1:8");
    expect(plan.aiCandidateIds).not.toContain("1:10");
    expect(plan.aiCandidateIds).toContain("1:4");
  });

  it("builds a request that marks only candidates and includes context", () => {
    const [req] = buildAiRequests(scan, plan.aiCandidateIds, plan.ruleResults);
    expect(req.candidateIds).toEqual(plan.aiCandidateIds);
    expect(req.userPrompt).toContain('name="Product Card"');
    expect(req.userPrompt).toContain('text="Nike Air Max"');
    expect(req.userPrompt).toContain("- 1:4 (TEXT)");
    expect(req.userPrompt).not.toContain("- 1:8 (LINE)");
  });

  it("lets AI results override medium/low rule guesses", () => {
    const ai = new Map([
      ["1:4", { name: "Product Name", confidence: "high" as const }],
      ["1:9", { name: "Favorite Icon", confidence: "medium" as const }],
    ]);
    const s = byId(buildSuggestions(plan, ai));
    expect(s["1:4"]).toMatchObject({ proposedName: "Product Name", source: "ai", selected: true });
    expect(s["1:9"]).toMatchObject({ proposedName: "Favorite Icon", source: "ai", selected: true });
    expect(s["1:8"]).toMatchObject({ proposedName: "Divider", source: "rule" });
  });
});

describe("validateAiResponse", () => {
  const allowed = ["1:4", "1:9"];

  it("rejects structurally invalid responses outright", () => {
    expect(validateAiResponse(null, allowed).ok).toBe(false);
    expect(validateAiResponse({ names: [] }, allowed).ok).toBe(false);
    expect(validateAiResponse({ suggestions: [{ nodeId: "1:4", proposedName: "X" }] }, allowed).ok).toBe(false);
  });

  it("drops hallucinated ids, duplicates and bad names, keeps the rest", () => {
    const result = validateAiResponse(
      {
        suggestions: [
          { nodeId: "1:4", proposedName: "Product Name", confidence: "high" },
          { nodeId: "1:4", proposedName: "Title", confidence: "high" }, // duplicate
          { nodeId: "9:99", proposedName: "Ghost Layer", confidence: "high" }, // never sent
          { nodeId: "1:9", proposedName: "Vector 9", confidence: "low" }, // still generic
        ],
      },
      allowed,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.suggestions.keys()]).toEqual(["1:4"]);
    expect(result.suggestions.get("1:4")?.name).toBe("Product Name");
    expect(result.dropped).toBe(3);
  });
});

describe("content-named text option", () => {
  it("renames text layers named after their content only when asked", () => {
    const scan = productCard();
    const off = byId(buildSuggestions(planRoot(scan)));
    const on = byId(buildSuggestions(planRoot(scan, { includeContentNamedText: true })));
    expect(off["1:7"]).toBeUndefined();
    // "Add to cart" -> "Add to Cart": a real improvement, and the layer is now a deliberate name.
    expect(on["1:7"]).toMatchObject({ proposedName: "Add to Cart", confidence: "high" });
  });
});

describe("best-guess fallbacks", () => {
  // Shapes like the ones in the user's screenshot: plain frames and ellipses with no strong signal.
  const scan = tree({
    id: "5:1",
    type: "FRAME",
    name: "Home",
    width: 390,
    height: 844,
    children: [
      {
        id: "5:2",
        type: "FRAME",
        name: "Frame 9",
        width: 170,
        height: 120,
        hasFill: true,
        cornerRadius: 12,
        children: [
          { id: "5:3", type: "TEXT", name: "Pay someone", text: "Pay someone" },
          { id: "5:4", type: "TEXT", name: "Text 2", text: "Pay for purchases or a service you received." },
        ],
      },
      { id: "5:5", type: "FRAME", name: "Frame 1", width: 358, height: 40, layoutMode: "HORIZONTAL", children: [] },
      { id: "5:6", type: "ELLIPSE", name: "Ellipse 1", width: 40, height: 40, hasFill: true },
      { id: "5:7", type: "ELLIPSE", name: "Ellipse 5", width: 8, height: 8, hasFill: true },
      { id: "5:8", type: "FRAME", name: "Frame 2", width: 358, height: 400, children: [] },
    ],
  });
  const s = byId(buildSuggestions(planRoot(scan)));

  it("gives every candidate a usable name, so review is just ticking", () => {
    for (const row of Object.values(s)) expect([row.currentName, checkProposedName(row.proposedName)]).toEqual([row.currentName, { ok: true, name: row.proposedName }]);
  });

  it("names containers after their leading text and structure", () => {
    expect(s["5:2"]).toMatchObject({ proposedName: "Pay Someone Card", confidence: "low", selected: false });
    expect(s["5:5"].proposedName).toBe("Row");
    expect(s["5:8"].proposedName).toBe("Content Area");
  });

  it("names plain shapes by likely role", () => {
    expect(s["5:6"].proposedName).toBe("Circle");
    expect(s["5:7"].proposedName).toBe("Status Dot");
  });
});
