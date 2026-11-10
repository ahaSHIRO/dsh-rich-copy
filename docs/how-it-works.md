# How it works (dsh-rich-copy)

This is a chapter of [README.md](../README.md). It describes the actual browser-side behaviour. The copy side has its own chapter: [Copy pipeline](./copy-pipeline.md). [中文](./how-it-works.zh.md). Architecture decisions live in [docs/adr/](./adr/).

## Injection and lifecycle

`dsh-client-modules` scans the profile for packages declaring `dsh.client` and serves `lib/client.js` into the page. The script only registers a `factory`; the work starts in `apply(ctx)` through `runtime.mount`: a `MutationObserver`, two capture listeners (`copy` / `click`), a 300ms debounced scan and eight 2-second retries. `ctx.on("dispose")` binds to `runtime.unmount`, the single reclamation point for every side effect: disconnect the observer, clear timers, restore `navigator.clipboard.writeText`, remove DOM getter patches and clear all cross-event state.

## Highlighting

- **ArkTS / ETS code blocks**: the [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS) TextMate grammar is bundled; [Shiki](https://shiki.style) is lazy-loaded from a CDN and `codeToHtml` rewrites `code.innerHTML`, followed by a decorator patch. If the CDN is unreachable this enhancement is skipped and the host's own highlighting is untouched.
- **Diff cards**: the `highlighter` module has two adapters. A built-in regex tokenizer paints rows synchronously with no network; once Shiki is ready it overwrites them with more accurate tokens in the background. Language inference has one owner: the card heading wins, otherwise the first row's path extension. Unknown extensions and blocks over 400 lines stay plain.

Theme output is always `var(--shiki-*)`. If Shiki lacks `createCssVariablesTheme`, loading fails and the built-in tokenizer takes over; there is no literal-colour theme fallback, so the colour representation never has a second form.

## Copy pipeline

The copy side is its own chapter: [Copy pipeline](./copy-pipeline.md) — payload construction, variable resolution and the solid-colour fallback, the 250ms host-write suppression window and the defensive guard against GenUI fence reflow.

## Debug and verification

`window.dshRichCopy` exposes behaviour commands:
- `copyOnce("code")` / `copyOnce("diff")`: reiterate the production button path (recognition, construction, window, write) and return `{wrote, payload}`.
- `rescan()` / `rescanDiff()`: force a rescan. `restart()`: reset one-shot degradation flags.
- `setDiffHighlight(on)` / `setFenceGuard(on)`: toggles.
- `diffDebug()`: state plus a summary of the first three diff cards.

`node tests/run.cjs` loads `tests/harness.html` in local headless Edge and asserts copy payloads, theme switching, collapsed expansion, the defensive guard and dispose reclamation outside the page, with zero npm dependencies.

## Project layout

```
dsh-rich-copy/
├── package.json          # dsh.bundle.patch + dsh.client declaration
├── cordis.patch.yml      # inserts the plugin row
├── index.js              # Loader shim, forwards to lib/index.js
├── GLOSSARY.md           # domain terms
├── README.md             # English overview
├── README.zh.md          # Chinese overview
├── docs/
│   ├── how-it-works.md       # this file
│   ├── how-it-works.zh.md    # Chinese version
│   ├── copy-pipeline.md      # copy chapter (English)
│   ├── copy-pipeline.zh.md   # copy chapter (Chinese)
│   └── adr/                  # architecture decisions
├── tests/
│   ├── harness.html      # headless Edge fixture
│   └── run.cjs           # assertion entry
└── lib/
    ├── index.js          # host-side no-op apply
    └── client.js         # all browser-side logic
```
