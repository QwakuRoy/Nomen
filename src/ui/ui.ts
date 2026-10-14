// Plugin UI: selection summary -> analyze -> preview/edit -> rename.

import { buildAiRequests, type AiSuggestion } from "../shared/aiContract";
import { buildSuggestions, planRoot, summarize, type RootPlan } from "../shared/engine";
import { checkProposedName } from "../shared/names";
import type { MainToUi, RenameSuggestion, RootInfo, RootScan, Settings, SkipReason, UiToMain } from "../shared/types";
import { NamingError, nameWithClaude } from "./ai";
import { icon, logo, typeIcon } from "./icons";

// ---------- State ----------

type View = "selection" | "settings" | "loading" | "preview" | "error" | "celebrate" | "success";
type Filter = "all" | "suggested" | "review";
type Row = RenameSuggestion & { review: boolean };

const state = {
  view: "selection" as View,
  returnView: "selection" as View,
  settings: { apiKey: null, includeContentNamedText: false } as Settings,
  selection: { roots: [] as RootInfo[], layerCount: 0, genericCount: 0, problem: undefined as string | undefined, received: false },
  loading: { step: 0, aiDone: 0, aiTotal: 0, usingAi: false },
  scan: [] as RootScan[],
  plans: [] as RootPlan[],
  rows: [] as Row[],
  usedAi: false,
  filter: "all" as Filter,
  error: { message: "", retryable: true },
  result: { renamed: 0, skipped: [] as { nodeId: string; name: string; reason: SkipReason }[] },
  /** The rows sent for renaming, with the names they were given. Shown on the results screen. */
  applied: [] as (Row & { newName: string })[],
  abort: null as AbortController | null,
};

const app = document.getElementById("app")!;
const send = (msg: UiToMain) => parent.postMessage({ pluginMessage: msg }, "*");

let resolveScan: ((roots: RootScan[]) => void) | null = null;
let rejectScan: ((e: Error) => void) | null = null;

// ---------- DOM helper ----------

type Props = Record<string, unknown> & { class?: string; html?: string };
type Child = Node | string | null | undefined | false;

function h(tag: string, props: Props = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// ---------- Derived ----------

function applicableRows(): Row[] {
  return state.rows.filter((r) => r.selected && r.proposedName !== r.currentName && checkProposedName(r.proposedName).ok);
}

// ---------- Actions ----------

function go(view: View) {
  state.view = view;
  render();
}

async function analyze(opts: { rulesOnly?: boolean } = {}) {
  const abort = new AbortController();
  state.abort = abort;
  state.loading = { step: 0, aiDone: 0, aiTotal: 0, usingAi: !!state.settings.apiKey && !opts.rulesOnly };
  go("loading");

  try {
    // 1. Read layers (main thread).
    const roots = await new Promise<RootScan[]>((resolve, reject) => {
      resolveScan = resolve;
      rejectScan = reject;
      send({ type: "scan" });
    });
    if (abort.signal.aborted) return;
    state.scan = roots;

    // 2. Deterministic rules.
    state.loading.step = 1;
    render();
    state.plans = roots.map((r) => planRoot(r, { includeContentNamedText: state.settings.includeContentNamedText }));

    // 3. Semantic naming (optional).
    let ai: Map<string, AiSuggestion> | undefined;
    const requests = state.plans.flatMap((p) => buildAiRequests(p.root, p.aiCandidateIds, p.ruleResults));
    state.loading.step = 2;
    if (state.loading.usingAi && requests.length > 0) {
      render();
      ai = await nameWithClaude(state.settings.apiKey!, requests, abort.signal, (done, total) => {
        state.loading.aiDone = done;
        state.loading.aiTotal = total;
        if (state.view === "loading") render();
      });
    }
    if (abort.signal.aborted) return;
    showPreview(ai);
  } catch (e) {
    if (abort.signal.aborted) return;
    const err = e instanceof NamingError ? e : new NamingError(e instanceof Error ? e.message : String(e), true);
    state.error = { message: err.message, retryable: err.retryable };
    go("error");
  } finally {
    if (state.abort === abort) state.abort = null;
  }
}

function showPreview(ai?: Map<string, AiSuggestion>) {
  state.usedAi = !!ai;
  state.rows = state.plans.flatMap((p) =>
    buildSuggestions(p, ai).map((s) => ({ ...s, review: !s.proposedName || s.confidence === "low" })),
  );
  state.filter = state.rows.some((r) => !r.review) ? "all" : "review";
  go("preview");
}

function cancel() {
  state.abort?.abort();
  state.abort = null;
  resolveScan = rejectScan = null;
  go("selection");
}

function applyChanges() {
  const rows = applicableRows();
  const changes = rows.map((r) => ({ nodeId: r.nodeId, expectedCurrentName: r.currentName, name: r.proposedName.trim() }));
  if (changes.length === 0) return;
  state.applied = rows.map((r) => ({ ...r, newName: r.proposedName.trim() }));
  send({ type: "apply", changes });
}

function backToSelection() {
  send({ type: "restore-selection" });
  go("selection");
}

// ---------- Views ----------

function header(): HTMLElement {
  const aiOn = !!state.settings.apiKey;
  return h(
    "div",
    { class: "header" },
    state.view === "settings"
      ? h("button", { class: "icon-btn", title: "Back", "aria-label": "Back", html: icon.back, onClick: () => go(state.returnView) })
      : null,
    state.view === "settings" ? h("h1", {}, "Settings") : h("h1", { html: logo }, "Nomen", h("span", { class: "subtitle" }, "Semantic layer naming")),
    h(
      "span",
      { class: `pill${aiOn ? " ai" : ""}`, title: aiOn ? "Names are generated with Claude" : "Names come from built-in rules only" },
      h("span", { class: "dot" }),
      aiOn ? "Claude" : "Rules only",
    ),
    state.view !== "settings" && state.view !== "loading"
      ? h("button", {
          class: "icon-btn",
          title: "Settings",
          "aria-label": "Settings",
          html: icon.settings,
          onClick: () => {
            state.returnView = state.view;
            go("settings");
          },
        })
      : null,
  );
}

function selectionView(): Node[] {
  const sel = state.selection;
  if (!sel.received) return [h("div", { class: "body" })];
  if (sel.roots.length === 0) {
    return [
      h(
        "div",
        { class: "body" },
        h(
          "div",
          { class: "center" },
          h("div", { class: "glyph", html: icon.layers }),
          h("h2", {}, sel.problem?.startsWith("Select a frame") ? "Nothing selected" : "Can't analyze this selection"),
          h("p", {}, sel.problem ?? ""),
        ),
      ),
    ];
  }

  const aiOn = !!state.settings.apiKey;
  const body = h(
    "div",
    { class: "body" },
    h("p", { class: "section-label" }, sel.roots.length === 1 ? "Selected" : `Selected · ${sel.roots.length} designs`),
    h(
      "ul",
      { class: "card root-list" },
      ...sel.roots.map((r) => h("li", {}, h("span", { class: "type", html: typeIcon(r.type) }), h("span", { class: "name" }, r.name))),
    ),
    h(
      "div",
      { class: "stats" },
      h("div", { class: "stat" }, h("div", { class: "num" }, String(sel.layerCount >= 2000 ? "2000+" : sel.layerCount)), h("div", { class: "muted" }, "layers detected")),
      h("div", { class: "stat" }, h("div", { class: "num" }, String(sel.genericCount)), h("div", { class: "muted" }, "with default names")),
    ),
    h(
      "label",
      { class: "check" },
      h("input", {
        type: "checkbox",
        checked: state.settings.includeContentNamedText,
        onChange: (e: Event) => send({ type: "save-settings", settings: { includeContentNamedText: (e.target as HTMLInputElement).checked } }),
      }),
      h(
        "span",
        {},
        "Also rename text layers named after their content",
        h("div", { class: "muted small" }, "e.g. a text layer called “£120” becomes “Price”"),
      ),
    ),
    sel.layerCount >= 2000
      ? h("div", { class: "notice warn", html: `${icon.alert}<span>Large selection. Only the first 2,000 layers will be analyzed.</span>` })
      : null,
    aiOn
      ? h("div", { class: "notice small" }, h("span", { html: icon.sparkle }), h("span", {}, "Layer names, text and structure are sent to Anthropic's API to generate names. Nothing changes until you approve."))
      : h(
          "div",
          { class: "notice small" },
          h("span", { html: icon.info }),
          h(
            "span",
            {},
            "Using built-in rules. ",
            h("button", { class: "link", onClick: () => ((state.returnView = "selection"), go("settings")) }, "Add an Anthropic API key"),
            " for context-aware names like “Product Card”.",
          ),
        ),
  );

  const footer = h(
    "div",
    { class: "footer" },
    h(
      "button",
      { class: "btn primary block", disabled: sel.genericCount === 0 && !state.settings.includeContentNamedText, onClick: () => analyze() },
      "Analyze Layers",
    ),
  );
  const note =
    sel.genericCount === 0 && !state.settings.includeContentNamedText
      ? h("div", { class: "notice", html: `${icon.check}<span>Every layer here already has a name. Nothing to clean up.</span>` })
      : null;
  if (note) body.append(note);
  return [body, footer];
}

function loadingView(): Node[] {
  const { step, aiDone, aiTotal, usingAi } = state.loading;
  const name = state.selection.roots.length === 1 ? state.selection.roots[0].name : `${state.selection.roots.length} designs`;
  const stepEl = (i: number, label: string, detail?: string, skipped = false) =>
    h(
      "li",
      { class: `step ${skipped ? "skipped" : step > i ? "done" : step === i ? "active" : ""}` },
      h("span", { class: "mark", html: step > i && !skipped ? icon.checkSmall : "" }),
      h("span", {}, label, detail ? h("span", { class: "muted" }, ` · ${detail}`) : null),
    );
  return [
    h(
      "div",
      { class: "body" },
      h("p", { class: "section-label" }, "Analyzing"),
      h("h2", { style: "margin:0;font-size:13px;line-height:20px" }, name),
      h(
        "ol",
        { class: "steps" },
        stepEl(0, "Reading layers"),
        stepEl(1, "Applying naming rules"),
        usingAi
          ? stepEl(2, "Generating semantic names", aiTotal > 1 ? `batch ${Math.min(aiDone + 1, aiTotal)} of ${aiTotal}` : undefined)
          : stepEl(2, "Semantic naming skipped", "rules only", true),
      ),
      h("p", { class: "muted", style: "margin-top:12px" }, "Your file won't change until you review and approve the names."),
    ),
    h("div", { class: "footer" }, h("span", { class: "grow" }), h("button", { class: "btn", onClick: cancel }, "Cancel")),
  ];
}

function rowView(row: Row): HTMLElement {
  const input = h("input", {
    class: "new",
    type: "text",
    value: row.proposedName,
    placeholder: "Type a name",
    spellcheck: "false",
    "aria-label": `New name for ${row.currentName}`,
  }) as HTMLInputElement;
  const checkbox = h("input", { type: "checkbox", checked: row.selected, "aria-label": "Include this rename" }) as HTMLInputElement;
  const el = h(
    "div",
    { class: `row${row.selected ? "" : " off"}` },
    checkbox,
    h("span", { class: "type", html: typeIcon(row.type), title: row.type.toLowerCase() }),
    h(
      "div",
      { class: "names", style: `padding-left:${Math.min(Math.max(row.depth - 1, 0), 5) * 8}px` },
      h("div", { class: "old", title: row.currentName }, row.currentName),
      input,
    ),
    h(
      "div",
      { class: "meta" },
      row.edited
        ? h("span", { class: "badge edited" }, "Edited")
        : row.review
          ? h("span", { class: "badge review", title: "Best guess from limited context. Tick to accept, or edit it first." }, "Review")
          : h("span", { class: `conf ${row.confidence}`, title: `${row.confidence} confidence · ${row.source === "ai" ? "Claude" : "rule"}` }),
      h("button", { class: "icon-btn locate", title: "Show in canvas", "aria-label": "Show in canvas", html: icon.target, onClick: () => send({ type: "focus-node", nodeId: row.nodeId }) }),
    ),
  );

  const validate = () => {
    // A ticked row must have a usable name; an unticked empty row is fine.
    const ok = checkProposedName(row.proposedName).ok || (!row.proposedName && !row.selected);
    input.classList.toggle("invalid", !ok);
    input.title = ok ? "" : "Use a descriptive name (not a default like “Frame 3”), up to 60 characters.";
  };
  checkbox.addEventListener("change", () => {
    row.selected = checkbox.checked;
    el.classList.toggle("off", !row.selected);
    validate();
    if (row.selected && !checkProposedName(row.proposedName).ok) input.focus();
    updateCounts();
  });
  input.addEventListener("input", () => {
    row.proposedName = input.value;
    if (!row.edited) el.querySelector(".meta")?.firstElementChild?.replaceWith(h("span", { class: "badge edited" }, "Edited"));
    row.edited = true;
    row.selected = checkProposedName(input.value).ok;
    checkbox.checked = row.selected;
    el.classList.toggle("off", !row.selected);
    validate();
    updateCounts();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.value = row.proposedName = "";
      input.dispatchEvent(new Event("input"));
    }
  });
  validate();
  return el;
}

function previewView(): Node[] {
  const s = summarize(state.scan, state.rows);
  const counts = { all: state.rows.length, suggested: state.rows.filter((r) => !r.review).length, review: state.rows.filter((r) => r.review).length };
  const visible = state.rows.filter((r) => state.filter === "all" || (state.filter === "review") === r.review);
  const allChecked = visible.length > 0 && visible.every((r) => r.selected);

  const tab = (f: Filter, label: string) =>
    h("button", { class: `tab${state.filter === f ? " on" : ""}`, onClick: () => ((state.filter = f), render()) }, label, h("span", { class: "count" }, String(counts[f])));

  const toolbar = h(
    "div",
    { class: "toolbar" },
    h(
      "div",
      { class: "summary" },
      h("strong", {}, plural(state.rows.length, "suggested change")),
      h("span", { class: "muted" }, `${s.analyzed} analyzed · ${s.preserved} preserved`),
    ),
    h("div", { class: "tabs" }, tab("all", "All"), tab("suggested", "Suggested"), tab("review", "Needs review")),
  );

  const list = h("div", {});
  if (state.rows.length === 0) {
    list.append(h("div", { class: "empty-filter" }, "No layers with default names were found. Every name was preserved."));
  } else if (visible.length === 0) {
    list.append(h("div", { class: "empty-filter" }, state.filter === "review" ? "Nothing needs review." : "No confident suggestions. Check “Needs review”."));
  } else {
    const selectAll = h("input", { type: "checkbox", checked: allChecked, "aria-label": "Select all visible" }) as HTMLInputElement;
    selectAll.addEventListener("change", () => {
      for (const r of visible) r.selected = selectAll.checked;
      render();
    });
    if (state.filter === "review") {
      list.append(
        h(
          "div",
          { class: "notice small", style: "margin:8px 12px" },
          h("span", { html: icon.info }),
          h("span", {}, "These are best guesses from limited context. Tick Select all to accept them, or edit any name first."),
        ),
      );
    }
    list.append(
      h(
        "label",
        { class: "row select-all" },
        selectAll,
        h("span"),
        h("span", {}, allChecked ? "Deselect all" : `Select all ${plural(visible.length, "layer")}`),
        h("span"),
      ),
    );
    for (const plan of state.plans) {
      const rows = visible.filter((r) => r.rootId === plan.root.rootId);
      if (rows.length === 0) continue;
      if (state.plans.length > 1) {
        list.append(
          h(
            "div",
            { class: "group-head" },
            h("span", { class: "type", html: typeIcon(plan.root.rootType) }),
            h("span", { class: "name" }, plan.root.rootName),
            h("span", { class: "muted" }, plural(rows.length, "change")),
          ),
        );
      }
      for (const r of rows) list.append(rowView(r));
    }
  }

  const notices: Node[] = [];
  if (!state.usedAi && state.rows.some((r) => r.review)) {
    notices.push(
      h(
        "div",
        { class: "notice small", style: "margin:12px" },
        h("span", { html: icon.info }),
        h("span", {}, state.settings.apiKey ? "Semantic naming was skipped for this run; names come from rules." : "Rules alone can't name every layer. Add an API key in Settings for context-aware names."),
      ),
    );
  }
  if (state.scan.some((r) => r.truncated)) {
    notices.push(h("div", { class: "notice warn small", style: "margin:12px", html: `${icon.alert}<span>This selection was larger than 2,000 layers; only the first 2,000 were analyzed.</span>` }));
  }

  const n = applicableRows().length;
  const footer = h(
    "div",
    { class: "footer" },
    h("button", { class: "btn", onClick: backToSelection }, "Back"),
    h("span", { class: "grow", id: "selected-count" }, countLabel(n)),
    h("button", { class: "btn primary", id: "apply-btn", disabled: n === 0, onClick: applyChanges }, `Rename ${plural(n, "Layer")}`),
  );
  return [h("div", { class: "body flush" }, toolbar, list, ...notices), footer];
}

function countLabel(n: number): string {
  const missing = state.rows.filter((r) => r.selected && !checkProposedName(r.proposedName).ok).length;
  return `${n} of ${state.rows.length} selected${missing ? ` · ${missing} need${missing === 1 ? "s" : ""} a name` : ""}`;
}

function updateCounts() {
  const n = applicableRows().length;
  const count = document.getElementById("selected-count");
  const btn = document.getElementById("apply-btn") as HTMLButtonElement | null;
  if (count) count.textContent = countLabel(n);
  if (btn) {
    btn.textContent = `Rename ${plural(n, "Layer")}`;
    btn.disabled = n === 0;
  }
}

function errorView(): Node[] {
  return [
    h(
      "div",
      { class: "body" },
      h(
        "div",
        { class: "center" },
        h("div", { class: "glyph bad", html: icon.alert }),
        h("h2", {}, "Couldn't generate names"),
        h("p", {}, state.error.message),
        h("p", { class: "small" }, "Your file hasn't been changed."),
      ),
    ),
    h(
      "div",
      { class: "footer" },
      h("button", { class: "btn", onClick: () => go("selection") }, "Back"),
      h("span", { class: "grow" }),
      h("button", { class: "btn", onClick: () => analyze({ rulesOnly: true }) }, "Use rules only"),
      state.error.retryable ? h("button", { class: "btn primary", onClick: () => analyze() }, "Retry") : null,
    ),
  ];
}

const SKIP_REASONS: Record<SkipReason, string> = {
  deleted: "deleted",
  "not-analyzed": "not part of analysis",
  "invalid-name": "invalid name",
  "renamed-since-analysis": "renamed while open",
  error: "couldn't be renamed",
};

const CELEBRATE_MS = 1600;
let celebrateTimer: ReturnType<typeof setTimeout> | undefined;

function celebrateView(): Node[] {
  const { renamed, skipped } = state.result;
  const skip = () => {
    clearTimeout(celebrateTimer);
    go("success");
  };
  return [
    h(
      "div",
      { class: "body celebrate", onClick: skip, title: "Click to see the renamed layers" },
      h(
        "div",
        { class: "center" },
        h("div", { class: "glyph ok burst", html: icon.check }),
        h("h2", { class: "rise" }, `${plural(renamed, "layer")} renamed`),
        skipped.length ? h("p", { class: "rise" }, `${plural(skipped.length, "layer")} skipped`) : null,
        h("p", { class: "small rise" }, "Changed your mind? Undo in Figma with ⌘Z / Ctrl+Z."),
      ),
    ),
  ];
}

function doneRow(row: RenameSuggestion & { newName: string }): HTMLElement {
  return h(
    "div",
    { class: "row done" },
    h("span", { class: "tick", html: icon.checkSmall }),
    h("span", { class: "type", html: typeIcon(row.type), title: row.type.toLowerCase() }),
    h(
      "div",
      { class: "names", style: `padding-left:${Math.min(Math.max(row.depth - 1, 0), 5) * 8}px` },
      h("div", { class: "old", title: row.currentName }, h("s", {}, row.currentName)),
      h("div", { class: "new-name", title: row.newName }, row.newName),
    ),
    h(
      "div",
      { class: "meta" },
      h("button", { class: "icon-btn locate", title: "Show in canvas", "aria-label": "Show in canvas", html: icon.target, onClick: () => send({ type: "focus-node", nodeId: row.nodeId }) }),
    ),
  );
}

function successView(): Node[] {
  const { renamed, skipped } = state.result;
  const skippedIds = new Set(skipped.map((s) => s.nodeId));
  const done = state.applied.filter((r) => !skippedIds.has(r.nodeId));

  const list = h("div", {});
  for (const plan of state.plans) {
    const rows = done.filter((r) => r.rootId === plan.root.rootId);
    if (rows.length === 0) continue;
    if (state.plans.length > 1) {
      list.append(
        h(
          "div",
          { class: "group-head" },
          h("span", { class: "type", html: typeIcon(plan.root.rootType) }),
          h("span", { class: "name" }, plan.root.rootName),
          h("span", { class: "muted" }, plural(rows.length, "layer")),
        ),
      );
    }
    for (const r of rows) list.append(doneRow(r));
  }
  if (skipped.length) {
    list.append(
      h("div", { class: "group-head" }, h("span", { class: "name" }, "Skipped"), h("span", { class: "muted" }, plural(skipped.length, "layer"))),
      h(
        "ul",
        { class: "skipped-list small", style: "padding:0 12px" },
        ...skipped.map((s) => h("li", {}, h("span", {}, s.name), h("span", { class: "muted" }, SKIP_REASONS[s.reason]))),
      ),
    );
  }

  const banner = h(
    "div",
    { class: `done-banner${renamed > 0 ? "" : " none"}` },
    h("span", { class: "done-icon", html: renamed > 0 ? icon.check : icon.alert }),
    h(
      "div",
      {},
      h("strong", {}, renamed > 0 ? `${plural(renamed, "layer")} renamed` : "No layers renamed"),
      h("div", { class: "muted small" }, renamed > 0 ? "Changed your mind? Undo in Figma with ⌘Z / Ctrl+Z." : "Nothing in your file was changed."),
    ),
  );

  return [
    h("div", { class: "body flush" }, h("div", { class: "toolbar done-toolbar" }, banner), list),
    h(
      "div",
      { class: "footer" },
      h("button", { class: "btn", onClick: () => send({ type: "close" }) }, "Close"),
      h("span", { class: "grow" }),
      h(
        "button",
        {
          class: "btn primary",
          onClick: () => {
            send({ type: "refresh-selection" });
            go("selection");
          },
        },
        "Analyze Another",
      ),
    ),
  ];
}

function settingsView(): Node[] {
  const key = state.settings.apiKey;
  const input = h("input", { type: "password", id: "api-key", placeholder: key ? "Paste a new key to replace it" : "sk-ant-…", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const save = () => {
    const value = input.value.trim();
    if (!value) return;
    send({ type: "save-settings", settings: { apiKey: value } });
    input.value = "";
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && save());
  return [
    h(
      "div",
      { class: "body" },
      h(
        "div",
        { class: "field" },
        h("label", { for: "api-key" }, "Anthropic API key"),
        input,
        h("div", { class: "muted small" }, key ? `Saved key ending in …${key.slice(-4)}` : "No key saved. Naming uses built-in rules only."),
      ),
      h(
        "div",
        { class: "inline-actions" },
        h("button", { class: "btn primary", onClick: save }, "Save key"),
        key ? h("button", { class: "btn", onClick: () => send({ type: "save-settings", settings: { apiKey: null } }) }, "Remove key") : null,
      ),
      h("p", { class: "section-label", style: "margin-top:20px" }, "Privacy"),
      h("p", { class: "muted" }, "With a key, the plugin sends the names, types, sizes and text content of layers in your selection to api.anthropic.com to generate names. It doesn't send images or anything outside your selection."),
      h("p", { class: "muted" }, "Your key is stored only on this device (Figma client storage) and is sent only to Anthropic."),
      h("p", { class: "muted" }, "Without a key, everything runs locally using built-in naming rules."),
    ),
  ];
}

function render() {
  const views: Record<View, () => Node[]> = {
    selection: selectionView,
    settings: settingsView,
    loading: loadingView,
    preview: previewView,
    error: errorView,
    celebrate: celebrateView,
    success: successView,
  };
  // Keep the preview scroll position across re-renders (tab switches, select all).
  const scroller = app.querySelector(".body");
  const scrollTop = state.view === "preview" && scroller ? scroller.scrollTop : 0;
  app.replaceChildren(header(), ...views[state.view]());
  const next = app.querySelector(".body");
  if (next && scrollTop) next.scrollTop = scrollTop;
}

// ---------- Messages from main ----------

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as MainToUi | undefined;
  if (!msg) return;
  switch (msg.type) {
    case "selection":
      state.selection = { roots: msg.roots, layerCount: msg.layerCount, genericCount: msg.genericCount, problem: msg.problem, received: true };
      if (state.view === "selection") render();
      break;
    case "settings":
      state.settings = msg.settings;
      if (state.view !== "loading" && state.view !== "preview") render();
      else app.querySelector(".header")?.replaceWith(header());
      break;
    case "scan-result":
      resolveScan?.(msg.roots);
      resolveScan = rejectScan = null;
      break;
    case "scan-error":
      rejectScan?.(new NamingError(`Couldn't read the selected layers: ${msg.message}`, true));
      resolveScan = rejectScan = null;
      break;
    case "apply-result":
      state.result = { renamed: msg.renamed, skipped: msg.skipped };
      send({ type: "restore-selection" });
      if (msg.renamed > 0) send({ type: "notify", message: `${plural(msg.renamed, "layer")} renamed` });
      if (msg.renamed > 0) {
        // A short full-panel moment that confirms the change, then the list of what changed.
        go("celebrate");
        clearTimeout(celebrateTimer);
        celebrateTimer = setTimeout(() => state.view === "celebrate" && go("success"), CELEBRATE_MS);
      } else {
        go("success");
      }
      break;
  }
};

render();
send({ type: "ui-ready" });

// If the host missed "ui-ready" (it can load after us), ask again until the selection arrives.
let readyRetries = 0;
const readyTimer = setInterval(() => {
  if (state.selection.received || ++readyRetries > 10) clearInterval(readyTimer);
  else send({ type: "ui-ready" });
}, 500);
