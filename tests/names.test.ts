import { describe, expect, it } from "vitest";
import { checkProposedName, classifyName, isGenericName, toTitleCase } from "../src/shared/names";

describe("isGenericName", () => {
  it.each(["Frame 293", "Rectangle 18", "Group 52", "Text 21", "Vector 9", "Ellipse 3", "Line 8", "Frame", "Rectangle", "Frame 12 copy", "Frame 12 copy 3", "frame 4", "Group 4 (1)"])(
    "flags %s",
    (name) => expect(isGenericName(name)).toBe(true),
  );

  it.each(["Checkout Button", "Header", "Frame Selector", "Product Card", "Text Input", "Vectorized Logo", "Image Gallery"])(
    "keeps %s",
    (name) => expect(isGenericName(name)).toBe(false),
  );
});

describe("classifyName", () => {
  it("treats Figma auto-named text layers as content-named", () => {
    expect(classifyName("Add to cart", "TEXT", "Add to cart")).toBe("content");
  });
  it("treats a renamed text layer as intentional", () => {
    expect(classifyName("Price", "TEXT", "£120")).toBe("intentional");
  });
  it("treats generic names as generic regardless of type", () => {
    expect(classifyName("Text 21", "TEXT", "Hello")).toBe("generic");
  });
});

describe("toTitleCase", () => {
  it.each([
    ["Forgot password?", "Forgot Password"],
    ["Add to cart", "Add to Cart"],
    ["Search", "Search"],
    ["continue", "Continue"],
    ["FAQ and help", "FAQ and Help"],
    ["Buy on iPhone", "Buy on iPhone"],
  ])("%s -> %s", (input, out) => expect(toTitleCase(input)).toBe(out));
});

describe("checkProposedName", () => {
  it("accepts and tidies good names", () => {
    expect(checkProposedName("  Product   Card ")).toEqual({ ok: true, name: "Product Card" });
  });
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["Frame 3", "still generic"],
    ["x".repeat(61), "too long"],
    ["123", "no letters"],
    ['"Header"', "unexpected formatting"],
    [42, "not a string"],
  ])("rejects %j (%s)", (input, reason) => expect(checkProposedName(input)).toEqual({ ok: false, reason }));
});
