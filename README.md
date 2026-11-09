# dsh-rich-copy

A client plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) — does two things:

1. **ArkTS / ETS syntax highlighting** for `arkts` and `ets` code blocks in the web GUI. Ships the [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS) TextMate grammar (MIT) and loads [Shiki](https://shiki.style) from esm.sh at runtime — no build step, no npm dependencies.
2. **One-click rich-text copy** — works for code blocks in *any* language, not just `ets` / `arkts`: the code-block copy button and `Ctrl+C` selection both write self-contained `text/html` to the clipboard, so pasting into Snipaste (or any HTML-aware tool) preserves colors, fonts, and background.

[中文说明](./README.zh.md)

## Features

- **Highlighting** — `struct`, `@interface`, `import lazy`, and all TypeScript keywords light up; decorators (`@Entry`, `@State`, `@Provide`, …) render in a DevEco-style bright gold (`light-dark(#9a6700, #ffd75f)`). Theme-aware: follows DSH light/dark mode.
- **Rich-text copy (any language)** — not limited to `ets` / `arkts`: copying any `.md-code-block` (javascript, python, sql, …) resolves every `var(--shiki-*)` / `light-dark(...)` reference to literal `rgb(...)` before writing the clipboard, so the exported HTML renders correctly outside DSH. Comments and strings are never recolored.
- **Zero dependencies** — no `npm install` needed; Shiki is fetched from a CDN on first use.
- **Graceful degradation** — if the CDN is unreachable the plugin silently skips and DSH's built-in highlighting is untouched.

## Install

Prerequisite: a DSH web profile (lives at `~/.dsh/profiles/web`).

### Option A — `link:` install (recommended for development)

```bash
dsh plugin --profile web add link:https://github.com/ahaSHIRO/dsh-rich-copy
```

Restart `dsh web` afterwards.

### Option B — clone into `node_modules`

```bash
mkdir -p ~/.dsh/profiles/web/node_modules
git clone https://github.com/ahaSHIRO/dsh-rich-copy.git \
  ~/.dsh/profiles/web/node_modules/dsh-rich-copy
```

Then add it to `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json` (the `dsh plugin` command above does this for you).

## Usage

After restart, any fenced code block tagged `arkts` or `ets` is highlighted automatically:

    ```arkts
    @Entry
    @Component
    struct HomePage {
      @State message: string = 'Hello';
      build() { /* ... */ }
    }
    ```

- Click the **复制** button on any code block → paste into Snipaste → colors preserved.
- Select code and press `Ctrl+C` → same result.
- Copy works for code blocks in any language; the highlighting enhancement applies only to `ets` / `arkts`.

## How it works

| Step | What happens |
|---|---|
| 1 | `dsh-client-modules` scans the profile for `dsh.client` packages and serves `lib/client.js` into the page. |
| 2 | The plugin watches the DOM for `.md-code-block` containers whose banner reads `ets` or `arkts` and applies the highlighting enhancement. (The copy interception in step 4 is language-agnostic.) |
| 3 | It lazily loads Shiki + the ArkTS grammar from esm.sh and rewrites the block's `innerHTML` with highlighted tokens. |
| 4 | A capture-phase `copy` listener intercepts every copy: it attaches the cloned selection to the live document, calls `getComputedStyle` to resolve `var(...)` / `light-dark(...)` to literal `rgb(...)`, then writes self-contained `text/html` + `text/plain` to the clipboard. |

Debug hook: `window.dshRichCopy.rescan()` in the console forces a re-scan.

## Project layout

```
dsh-rich-copy/
├── package.json          # dsh.bundle.patch + dsh.client declaration
├── cordis.patch.yml      # inserts the plugin row
├── index.js              # Loader shim (forwards to lib/index.js)
└── lib/
    ├── index.js          # host side: no-op (pure client plugin)
    └── client.js         # all client logic (~16 KB, no dependencies)
```

## License

MIT. The bundled ArkTS TextMate grammar is from [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS) (MIT).
