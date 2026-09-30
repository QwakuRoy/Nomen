// Types shared by the plugin controller (main thread) and the plugin UI (iframe).

export type Confidence = "high" | "medium" | "low";

/** Why a layer's current name is (or isn't) a rename candidate. */
export type NameStatus =
  /** Figma-generated, e.g. "Frame 293", "Rectangle", "Group 4 copy". */
  | "generic"
  /** A text layer whose name simply mirrors its content (Figma auto-naming). */
  | "content"
  /** Anything else: treated as a deliberate name and preserved. */
  | "intentional";

/** Compact, serialisable description of one layer. Node IDs are the only link back to Figma. */
export type LayerContext = {
  id: string;
  type: string;
  name: string;
  nameStatus: NameStatus;
  depth: number;
  parentId?: string;
  childIds: string[];
  /** Text content (TEXT nodes only), truncated. */
  text?: string;
  /** Main component name for instances, e.g. "Button / Primary / Default". */
  componentName?: string;
  width: number;
  height: number;
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "GRID";
  hasFill: boolean;
  hasImageFill: boolean;
  hasStroke: boolean;
  cornerRadius?: number;
  visible: boolean;
};

export type RootScan = {
  rootId: string;
  rootName: string;
  rootType: string;
  /** Root first, then descendants in depth-first order. */
  layers: LayerContext[];
  /** True when the node cap was hit and some descendants were not analyzed. */
  truncated: boolean;
};

export type RootInfo = { id: string; name: string; type: string };

export type SuggestionSource = "rule" | "ai" | "none";

export type RenameSuggestion = {
  nodeId: string;
  rootId: string;
  type: string;
  depth: number;
  currentName: string;
  /** Empty string when nothing could be inferred. */
  proposedName: string;
  confidence: Confidence;
  source: SuggestionSource;
  selected: boolean;
  /** User typed their own name. */
  edited: boolean;
};

export type SkipReason = "deleted" | "not-analyzed" | "invalid-name" | "renamed-since-analysis" | "error";

export type RenameChange = { nodeId: string; expectedCurrentName: string; name: string };

export type Settings = { apiKey: string | null; includeContentNamedText: boolean };

// ---- Messages: main -> UI ----
export type MainToUi =
  | {
      type: "selection";
      roots: RootInfo[];
      layerCount: number;
      genericCount: number;
      /** Explains why the selection can't be analyzed, when it can't. */
      problem?: string;
    }
  | { type: "scan-result"; roots: RootScan[] }
  | { type: "scan-error"; message: string }
  | {
      type: "apply-result";
      renamed: number;
      skipped: { nodeId: string; name: string; reason: SkipReason }[];
    }
  | { type: "settings"; settings: Settings };

// ---- Messages: UI -> main ----
export type UiToMain =
  | { type: "ui-ready" }
  | { type: "scan" }
  | { type: "apply"; changes: RenameChange[] }
  | { type: "focus-node"; nodeId: string }
  | { type: "restore-selection" }
  /** Ask for the current selection again (counts change after a rename). */
  | { type: "refresh-selection" }
  | { type: "save-settings"; settings: Partial<Settings> }
  | { type: "notify"; message: string; error?: boolean }
  | { type: "close" };
