# Copy pipeline (dsh-rich-copy)

This is a chapter of [README.md](../README.md) covering how a copy travels from the host DOM to the clipboard. The general browser-side behaviour lives in [How it works](./how-it-works.md). [中文](./copy-pipeline.zh.md). Architecture decisions live in [docs/adr/](./adr/).

## Rich-text copy

The `clipboard` module collapses CopySource and CopyTrigger into one interface producing an `{html, text}` payload:

1. Selection copy (`Ctrl+C`) and button copy share one entry point. The button path builds the payload, then the write side selects a single off-screen one-character span inside the synchronous click stack and calls `document.execCommand("copy")`; `copyCapture` writes the payload into `clipboardData`. This keeps user activation and avoids native layout over a huge selection.
2. `serializer` shares one shell between the CodeBlock and DiffCard adapters: resolve `var(...)` / `light-dark(...)` to literal `rgb(...)`, clean the font stack, find the nearest solid ancestor background, blend translucent row tints into solid colours, add `- ` / `+ ` / `  ` prefixes and drop the `<pre><code>` wrapper so paste targets do not reset the font. Variables the host never defines (the web host ships no `--shiki-foreground`) fall back to the shell's own solid foreground/background — the same colour the browser renders for the invalid declaration — so the exported HTML never carries a live `var()` that would revert to black text in paste targets.
3. A collapsed diff card auto-expands on copy. If React 18 has not committed yet, `hostAdapter` reads the full row list from the fiber synchronously so nothing is missing.
4. The host button's trailing `writeText` is silenced for 250ms so it cannot overwrite the rich payload, while the host's "copied" icon feedback still fires. The suppression window's lifecycle belongs to the write module alone: callers may only open it, and it closes only on its own timer or on dispose. A caller-side early close once let the host's plain-text write overwrite the just-written rich payload — the same click still holds a second writer, so the module must keep the window open across all of them.
5. The suppression is multi-instance safe. The host's `client-hmr` polls plugin files every 500ms and hot-reloads the module **without disposing the old instance**, so leaked instances can coexist and each opens its own window on the same click. The module therefore stores the one true native `writeText` in a shared slot on `navigator.clipboard`, marks its swallow with a recognizable property, refuses to stack a new swallow over an existing one, and always restores from the shared slot. A new instance heals any stuck legacy swallow at mount (recognised by source; the native is recovered from `Clipboard.prototype`). Without this, the second instance saved the first instance's swallow as its "original" and its timer wrote the swallow back permanently — every host message copy (its own `writeText` path) silently stopped working.

## Defensive guard

`fenceGuard` is a standalone adapter. When a session contains a GenUI fence with `"panel": true`, the host mistakes an empty `.genui-dom-fence` for a wiped container and rebuilds it every frame, causing continuous full-page reflow. The adapter overrides the `childElementCount` getter on those instances (returns 1 when the real count is 0) without inserting any DOM node, stopping the loop. It toggles independently and all getters are removed on dispose.

Host internals (React fiber private keys, button attributes, DOM class names) live only inside `hostAdapter`'s implementation; the main module does not depend on them.
