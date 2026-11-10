# dsh-rich-copy

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) client plugin that does three things:

1. **ArkTS / ETS syntax highlighting** for code blocks marked `arkts` / `ets` in the web GUI. The [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS) TextMate grammar (MIT) is bundled; [Shiki](https://shiki.style) is loaded from a CDN at runtime. No build step, no npm dependencies.
2. **One-click rich-text copy** for code blocks in any language (not just `ets` / `arkts`): both the copy button and `Ctrl+C` selection write self-contained `text/html`, so pasting into Snipaste keeps colours, font and background.
3. **Diff card highlighting**: the host's diff cards are coloured by file extension, and copying also carries row tints and `+` / `-` prefixes.

[中文](./README.zh.md) · [How it works](./docs/how-it-works.md) · [Architecture decisions](./docs/adr/)

## Features

- **Highlighting** — `struct`, `@interface`, `import lazy` and all TypeScript keywords; decorators in DevEco-style amber, following the DSH light/dark theme.
- **Rich-text copy (all languages)** — resolves `var(--shiki-*)` / `light-dark(...)` to literal `rgb(...)` (variables the host never defines fall back to the block's own solid colours), cleans the font stack and blends translucent row tints into solid colours. The exported HTML renders correctly outside DSH.
- **Diff highlighting** — a built-in regex tokenizer paints rows immediately, then Shiki upgrades them in the background. Unknown extensions and blocks over 400 lines stay plain; `setDiffHighlight(false)` turns it off.
- **Zero dependencies** — no `npm install`; Shiki is fetched from a CDN on first use.
- **Graceful degradation** — the built-in tokenizer keeps working when the CDN is unreachable; the ArkTS enhancement is skipped silently.
- **Collapse aware** — copying a collapsed diff card expands it and copies every row.

## Install

Prerequisite: a configured DSH web profile at `~/.dsh/profiles/web`.

```bash
dsh plugin --profile web add link:https://github.com/ahaSHIRO/dsh-rich-copy
```

Then restart `dsh web`. Alternatively clone into `~/.dsh/profiles/web/node_modules/dsh-rich-copy` and add it to that profile's `dsh.profile.bundles`.

## Usage

After restart, any fenced block marked `arkts` or `ets` highlights automatically:

    ```arkts
    @Entry
    @Component
    struct HomePage {
      @State message: string = 'Hello';
      build() { /* ... */ }
    }
    ```

- Click the copy button or select and press `Ctrl+C`, then paste into Snipaste — colours survive.
- Copy works for every language; the highlighting enhancement targets `ets` / `arkts` only.
- Diff cards are coloured by path extension; the corner copy button produces row tints and `+` / `-` prefixes.
- `window.dshRichCopy.copyOnce("code")` in the console reiterates the production button path (recognition, construction, window, write) and returns `{wrote, payload}`. See [How it works](./docs/how-it-works.md) for the other commands.

## Verify

```bash
node tests/run.cjs
```

Uses local headless Edge to assert copy payloads, theme switching, collapsed expansion, the defensive guard and dispose reclamation outside the page. Zero npm dependencies.

## Docs

- [How it works (English)](./docs/how-it-works.md) / [工作原理(中文)](./docs/how-it-works.zh.md)
- [Copy pipeline (English)](./docs/copy-pipeline.md) / [复制管线(中文)](./docs/copy-pipeline.zh.md)
- [GLOSSARY.md](./GLOSSARY.md) — domain terms
- [docs/adr/](./docs/adr/) — architecture decisions

## License

MIT. The bundled ArkTS TextMate grammar is from [ohosvscode/arkTS](https://github.com/ohosvscode/arkTS) (MIT).
