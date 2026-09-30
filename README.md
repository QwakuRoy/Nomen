# Nomen: semantic layer naming for Figma

Select a frame, run the plugin, review the proposed names, rename. It turns `Frame 128 / Rectangle 18 / Text 34`
into `Product Card / Product Image / Price`, and it changes nothing until you approve.

## Run it in Figma

```bash
npm install
npm run build        # or: npm run watch
```

Then in the Figma desktop app go to **Plugins → Development → Import plugin from manifest…** and pick `manifest.json`.

- **Without an API key** the plugin uses built-in rules only. Nothing leaves your machine.
- **With an Anthropic API key** (⚙ Settings in the plugin), Claude names the layers the rules can't name confidently.

## How it works

```
Selection ─► main/code.ts (scan: LayerContext[] per root, capped at 2,000 layers)
          ─► ui/ui.ts ─► shared/engine.ts  (generic-name detection + rules)
                      ─► ui/ai.ts          (Claude, structured JSON, only for non-"high" rule results)
                      ─► shared/aiContract.ts validateAiResponse (ids must be ones we sent)
          ─► Preview (edit / exclude / needs review)
          ─► main/code.ts apply (re-resolve every id, re-validate every name, one undo step)
```

| File | Role |
| --- | --- |
| `src/main/code.ts` | Plugin controller: selection, traversal, context extraction, safe apply, settings storage |
| `src/shared/names.ts` | Generic-name detection, Title Case, name validation |
| `src/shared/rules.ts` | Deterministic rules: text labels, prices, dividers, images/avatars, backgrounds, icons, buttons, inputs, instances |
| `src/shared/aiContract.ts` | System prompt, layer outline, JSON schema, response validation |
| `src/shared/engine.ts` | Merges rules and AI output into reviewable suggestions |
| `src/ui/*` | Plugin UI (vanilla TS, Figma theme variables, so light and dark mode work) |
| `dev/harness.html` | Browser harness that fakes the Figma main thread, for UI work |

## Behaviour decisions (from the Stage 0 spec)

- **Conservative.** Only Figma default names (`Frame 12`, `Rectangle`, `Group 4 copy`, …) are candidates. The selected root and any intentional name are never renamed. Text layers auto-named from their content are included only when you tick the option.
- **Preview before mutation.** Low-confidence results appear under *Needs review* and are unchecked, so the existing name is kept.
- **Instances.** They're named from their main component (`Button / Primary` → `Button`), and the plugin doesn't descend into them.
- **Duplicates are allowed.** Repeated cards all become `Product Card`, with no numeric suffixes.
- **Safety.** AI output that fails schema validation rejects the whole run. Unknown or duplicate IDs and bad names are dropped. On apply, deleted nodes, nodes that weren't analyzed, and layers renamed while the preview was open are skipped and reported.
- **Failure.** An API error, timeout, invalid response or cancel leaves the document untouched. The error screen offers *Retry* or *Use rules only*.

## AI details

- Model `claude-opus-5-5`, effort `low` (latency matters in a plugin panel; raise it in `src/ui/ai.ts` if names need more thought).
- Structured output via `output_config.format` (JSON schema), with up to 120 candidates per request and 3 requests in parallel.
- Server-side refusal fallback (`fallbacks: "default"`) is enabled, so a safety-classifier decline is retried on a fallback model.
- The key lives in `figma.clientStorage` on the user's device. The manifest allows network access only to `https://api.anthropic.com`.
- What's sent: layer ids, types, names, sizes, a few style flags, text content (≤200 chars per layer) and component names. Images are never sent.

## Tests

```bash
npm test        # vitest: name detection, rules, merge, AI response validation
npm run typecheck
```

## Before publishing

- Replace `"id"` in `manifest.json` with the ID Figma assigns when you create the plugin.
- Metrics from spec §33 are not implemented. Add them only with a privacy-reviewed analytics endpoint.
