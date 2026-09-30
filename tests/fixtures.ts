import { classifyName } from "../src/shared/names";
import type { LayerContext, RootScan } from "../src/shared/types";

type Spec = Partial<LayerContext> & { id: string; type: string; name: string; children?: Spec[] };

/** Build a RootScan from a nested spec, filling in parent/child links and name status. */
export function tree(root: Spec): RootScan {
  const layers: LayerContext[] = [];
  const visit = (spec: Spec, depth: number, parentId?: string) => {
    const { children = [], ...rest } = spec;
    layers.push({
      width: 100,
      height: 40,
      hasFill: false,
      hasImageFill: false,
      hasStroke: false,
      visible: true,
      ...rest,
      depth,
      parentId,
      childIds: children.map((c) => c.id),
      nameStatus: classifyName(spec.name, spec.type, spec.text),
    });
    children.forEach((c) => visit(c, depth + 1, spec.id));
  };
  visit(root, 0);
  return { rootId: root.id, rootName: root.name, rootType: root.type, layers, truncated: false };
}

/** The product card from the Stage 0 spec (§12, Sibling Context). */
export const productCard = () =>
  tree({
    id: "1:1",
    type: "FRAME",
    name: "Shop",
    width: 390,
    height: 800,
    children: [
      {
        id: "1:2",
        type: "FRAME",
        name: "Product Card",
        width: 180,
        height: 260,
        children: [
          { id: "1:3", type: "RECTANGLE", name: "Rectangle 18", width: 180, height: 140, hasFill: true, hasImageFill: true },
          { id: "1:4", type: "TEXT", name: "Text 21", text: "Nike Air Max" },
          { id: "1:5", type: "TEXT", name: "Text 22", text: "£120" },
          {
            id: "1:6",
            type: "FRAME",
            name: "Frame 24",
            width: 160,
            height: 40,
            hasFill: true,
            cornerRadius: 8,
            layoutMode: "HORIZONTAL",
            children: [{ id: "1:7", type: "TEXT", name: "Add to cart", text: "Add to cart" }],
          },
        ],
      },
      { id: "1:8", type: "LINE", name: "Line 3", width: 390, height: 0 },
      { id: "1:9", type: "VECTOR", name: "Vector 9", width: 24, height: 24 },
      { id: "1:10", type: "INSTANCE", name: "Frame 99", componentName: "Button / Primary / Default" },
    ],
  });
