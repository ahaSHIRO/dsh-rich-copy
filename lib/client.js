// dsh-rich-copy 浏览器端包。
// 格式遵循 DSH 客户端模块契约:window.__ModuleLoader__.load({ id, factory }),
// factory 返回 cordis 插件 { apply }。无需任何共享模块(require 不使用)。
//
// 工作原理:
//   1. 页面里 DSH 自带的 Shiki 高亮器语言白名单不含 ets/arkts,
//      这类代码块渲染后只有无颜色的 span.line(没有带 style 的 span)。
//   2. 本插件用 MutationObserver 找到这些块(容器 .md-code-block,
//      横幅 [data-code-block-banner] 第一个子元素是语言名),
//      用 esm.sh 加载独立 Shiki 实例 + 内嵌的 ohosvscode/arkTS TextMate grammar,
//      就地替换 code 内容完成染色。主题用 css-variables(与 DSH 内置高亮同源,
//      自动跟随明暗主题)。
window.__ModuleLoader__.load({
  id: "dsh-rich-copy",
  factory: function () {
    var module = { exports: {} };

    var SHIKI_URL = "https://esm.sh/shiki@4.4.3";
    var TARGET_LANGS = { ets: true, arkts: true };

    // ohosvscode/arkTS packages/vscode/syntaxes/ets.tmLanguage.json(MIT)
    // 在 source.ts 基础上增补 struct / @interface / import lazy 三条规则。
    var GRAMMAR = 
{
  "name": "ArkTS",
  "scopeName": "source.ets",
  "patterns": [
    {
      "begin": "(?<![_$[:alnum:]])(?:(?<=\\.\\.\\.)|(?<!\\.))(?:(\\bexport)\\s+)?(?:(\\bdeclare)\\s+)?\\b(?:(abstract)\\s+)?\\b(struct)\\b(?=\\s+|/[/*])",
      "beginCaptures": {
        "1": {
          "name": "keyword.control.export.ts"
        },
        "2": {
          "name": "storage.modifier.ts"
        },
        "3": {
          "name": "storage.modifier.ts"
        },
        "4": {
          "name": "storage.type.class.ts"
        }
      },
      "end": "(?<=\\})",
      "name": "meta.struct.ets",
      "patterns": [
        {
          "include": "source.ts#class-declaration-or-expression-patterns"
        }
      ]
    },
    {
      "begin": "(?<![_$[:alnum:]])(?:(\\bexport)\\s+)?(?:(\\bdeclare)\\s+)?(@interface)\\b(?=\\s+|/[/*])",
      "beginCaptures": {
        "1": {
          "name": "keyword.control.export.ts"
        },
        "2": {
          "name": "storage.modifier.ts"
        },
        "3": {
          "name": "storage.type.class.ts"
        }
      },
      "end": "(?<=\\})",
      "name": "meta.at-interface.ets",
      "patterns": [
        {
          "include": "source.ts#class-declaration-or-expression-patterns"
        }
      ]
    },
    {
      "name": "meta.import.ets",
      "begin": "(?<![_$[:alnum:]])(?:(?<=\\.\\.\\.)|(?<!\\.))(?:(\\bexport)\\s+)?(?:(\\bdeclare)\\s+)?\\b(import)\\s+(lazy)(?:\\s+(type)(?!\\s+from))?(?!\\s*[:\\(])(?![_$[:alnum:]])(?:(?=\\.\\.\\.)|(?!\\.))",
      "beginCaptures": {
        "1": {
          "name": "keyword.control.export.ts"
        },
        "2": {
          "name": "storage.modifier.ts"
        },
        "3": {
          "name": "keyword.control.import.ts"
        },
        "4": {
          "name": "keyword.control.lazy.ets"
        },
        "5": {
          "name": "keyword.control.type.ts"
        }
      },
      "end": "(?<!^import|[^\\._$[:alnum:]]import)(?=;|$|^)",
      "patterns": [
        {
          "include": "source.ts#single-line-comment-consuming-line-ending"
        },
        {
          "include": "source.ts#comment"
        },
        {
          "include": "source.ts#string"
        },
        {
          "begin": "(?<=^import|[^\\._$[:alnum:]]import)(?!\\s*[\"'])",
          "end": "\\bfrom\\b",
          "endCaptures": {
            "0": {
              "name": "keyword.control.from.ts"
            }
          },
          "patterns": [
            {
              "include": "source.ts#import-export-declaration"
            }
          ]
        },
        {
          "include": "source.ts#import-export-declaration"
        }
      ]
    },
    { "include": "source.ts" }
  ],
  "fileTypes": ["ets"]
}

;

    var highlighterPack = null;
    function getHighlighter() {
      if (!highlighterPack) {
        highlighterPack = (async function () {
          var shiki = await import(SHIKI_URL);
          var theme = "github-dark";
          if (typeof shiki.createCssVariablesTheme === "function") {
            // 与 DSH 内置高亮同一套 --shiki-* CSS 变量,自动适配明暗主题
            theme = shiki.createCssVariablesTheme({
              name: "css-variables",
              variablePrefix: "--shiki-",
              fontStyle: true
            });
          }
          var h = await shiki.createHighlighter({ themes: [theme], langs: ["typescript"] });
          await h.loadLanguage(Object.assign({}, GRAMMAR, { embeddedLangs: ["typescript"] }));
          return { h: h, themeName: typeof theme === "string" ? theme : "css-variables" };
        })();
        highlighterPack.catch(function () { highlighterPack = null; });
      }
      return highlighterPack;
    }

    // 已染色文本缓存,避免流式渲染期间重复计算
    var done = new WeakMap();

    // 装饰器后处理:官方 grammar 只补了 struct/@interface/import lazy 三条规则,
    // ArkTS 装饰器会被 TS 语法吞成前景色(meta 作用域无主题色,实测顺序/注入都赢不了)。
    // 因此染色后做一次 DOM 补丁:对颜色仍是前景色的叶子 span,把其中的 @装饰器
    // 拆出来染成 DevEco 风格亮黄色。注释/字符串已被正确染色(非前景色),天然不受影响。
    var DECO_RE = /@(Entry|ComponentV2|Component|State|Prop|Link|Provide|Consume|Watch|ObservedV2|Observed|ObjectLink|BuilderParam|Builder|Styles|Extend|Local|Param|Event|Provider|Consumer|Monitor|Trace|Computed|Concurrent|Sendable|Preview|Require|Reusable|StorageLink|StorageProp|LocalStorageLink|LocalStorageProp|Track|Type)\b/g;
    var DECO_NAMES = /^(Entry|ComponentV2|Component|State|Prop|Link|Provide|Consume|Watch|ObservedV2|Observed|ObjectLink|BuilderParam|Builder|Styles|Extend|Local|Param|Event|Provider|Consumer|Monitor|Trace|Computed|Concurrent|Sendable|Preview|Require|Reusable|StorageLink|StorageProp|LocalStorageLink|LocalStorageProp|Track|Type)$/;
    var FG_COLOR = "var(--shiki-foreground)";
    // DevEco 风格亮黄,明暗主题各一档(light-dark 与 DSH 主题体系一致)
    var DECO_COLOR = "light-dark(#9a6700, #ffd75f)";

    function patchDecorators(codeEl) {
      var walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT);
      var targets = [];
      var n;
      while ((n = walker.nextNode())) targets.push(n);
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        var span = t.parentElement;
        if (!span || span.tagName !== "SPAN") continue;
        var c = span.style.color;
        if (c && c !== FG_COLOR) continue; // 已染色的(字符串/注释等)不动
        DECO_RE.lastIndex = 0;
        if (!DECO_RE.test(t.nodeValue)) continue;
        DECO_RE.lastIndex = 0;
        var frag = document.createDocumentFragment();
        var last = 0, m;
        while ((m = DECO_RE.exec(t.nodeValue))) {
          if (m.index > last) frag.appendChild(document.createTextNode(t.nodeValue.slice(last, m.index)));
          var s = document.createElement("span");
          s.style.color = DECO_COLOR;
          s.textContent = m[0];
          frag.appendChild(s);
          last = m.index + m[0].length;
        }
        frag.appendChild(document.createTextNode(t.nodeValue.slice(last)));
        span.parentNode.replaceChild(frag, span);
      }
      // 第二遍:TS 语法有时把 @Provide 拆成 "@" + "Provide" 两个 span,
      // 名字已被 TS 染成函数色。统一把 "@" 前缀和名字都刷成亮黄。
      var spans = [];
      var all = codeEl.querySelectorAll("span");
      for (var j = 0; j < all.length; j++) if (all[j].children.length === 0) spans.push(all[j]);
      for (var k = 0; k < spans.length - 1; k++) {
        var at = spans[k], name = spans[k + 1];
        if (!/@$/.test(at.textContent)) continue;
        var m2 = /^([A-Z][_$A-Za-z0-9]*)/.exec(name.textContent);
        if (!m2 || !DECO_NAMES.test(m2[1])) continue;
        at.style.color = DECO_COLOR;
        name.style.color = DECO_COLOR;
      }
    }

    function findBlocks() {
      var out = [];
      var containers = document.querySelectorAll(".md-code-block");
      for (var i = 0; i < containers.length; i++) {
        var el = containers[i];
        var banner = el.querySelector("[data-code-block-banner]");
        if (!banner || !banner.firstElementChild) continue;
        var lang = (banner.firstElementChild.textContent || "").trim().toLowerCase();
        if (!TARGET_LANGS[lang]) continue;
        var code = el.querySelector("pre code");
        if (!code) continue;
        if (code.querySelector("span[style]")) continue; // 已有颜色,跳过
        out.push(code);
      }
      return out;
    }

    var scanning = false;
    async function scan() {
      if (scanning) return;
      scanning = true;
      try {
        var blocks = findBlocks();
        if (!blocks.length) return;
        var pack;
        try {
          pack = await getHighlighter();
        } catch (e) {
          console.warn("[dsh-rich-copy] shiki 加载失败(网络?),稍后重试", e);
          return;
        }
        for (var i = 0; i < blocks.length; i++) {
          var code = blocks[i];
          if (!code.isConnected) continue;
          var text = code.innerText;
          if (!text || done.get(code) === text) continue;
          try {
            var html = pack.h.codeToHtml(text, { lang: "ArkTS", theme: pack.themeName });
            var tmp = document.createElement("div");
            tmp.innerHTML = html;
            var newCode = tmp.querySelector("code");
            if (!newCode) continue;
            patchDecorators(newCode);
            code.innerHTML = newCode.innerHTML;
            done.set(code, text);
          } catch (e) {
            console.warn("[dsh-rich-copy] 染色失败", e);
          }
        }
      } finally {
        scanning = false;
      }
    }

    var timer = null;
    function schedule() {
      if (timer) return;
      timer = setTimeout(function () { timer = null; scan(); }, 300);
    }

    // ── 富文本复制 ─────────────────────────────────────────────
    // DSH 代码块用 css-variables 主题,颜色是 var(--shiki-token-*)。
    // 直接 cloneContents() 会把未解析的 var() 带进剪贴板 HTML,
    // 离开 DSH 后变量失效 -> 黑字透明底(Snipaste 症状)。
    // 修复:把克隆片段临时挂回真实 DOM,用 getComputedStyle 把每个
    // var(...) 解析回字面 rgb 再序列化,得到自包含 HTML。
    function resolveVarStyles(root) {
      // 解析 var(...) 与 light-dark() 为字面 rgb,离开 DSH 后也能正确渲染
      var all = root.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var style = el.style;
        if (!style) continue;
        try {
          var cs = getComputedStyle(el);
          if (style.color && /var\(|light-dark\(/.test(style.color)) style.color = cs.color;
          if (style.backgroundColor && /var\(|light-dark\(/.test(style.backgroundColor)) style.backgroundColor = cs.backgroundColor;
          if (cs.fontStyle && cs.fontStyle !== "normal") style.fontStyle = cs.fontStyle;
          if (cs.fontWeight && cs.fontWeight !== "400" && cs.fontWeight !== "normal") style.fontWeight = cs.fontWeight;
        } catch (e) {}
      }
    }

    function wrapCodeHtml(blockEl, fragment) {
      // 临时挂载到真实 DOM 以解析 CSS 变量
      var tmp = document.createElement("div");
      tmp.style.cssText = "position:absolute;left:-9999px;top:-9999px;pointer-events:none;";
      tmp.appendChild(fragment);
      document.body.appendChild(tmp);
      resolveVarStyles(tmp);
      var innerHtml = tmp.innerHTML;
      document.body.removeChild(tmp);

      // 往上找最近带实色的祖先作为 pre 背景
      var bg = "transparent";
      var e = blockEl;
      while (e && e !== document.body && e !== document.documentElement) {
        var bgCS = getComputedStyle(e);
        if (bgCS.backgroundColor && bgCS.backgroundColor !== "rgba(0, 0, 0, 0)" && bgCS.backgroundColor !== "transparent") {
          bg = bgCS.backgroundColor;
          break;
        }
        e = e.parentElement;
      }

      var pre = blockEl ? blockEl.querySelector("pre") : null;
      var pcs = pre ? getComputedStyle(pre) : null;
      var wrap = document.createElement("pre");
      wrap.style.background = bg;
      wrap.style.color = (pcs ? pcs.color : "") || "#000";
      wrap.style.padding = (pcs ? pcs.padding : "") || "12px 16px";
      wrap.style.borderRadius = (pcs ? pcs.borderRadius : "") || "6px";
      wrap.style.fontFamily = (pcs ? pcs.fontFamily : "") || "monospace";
      wrap.style.fontSize = (pcs ? pcs.fontSize : "") || "13px";
      wrap.style.lineHeight = (pcs ? pcs.lineHeight : "") || "1.5";
      wrap.style.whiteSpace = "pre";
      wrap.innerHTML = innerHtml;
      return wrap.outerHTML;
    }

    function onCopyCapture(e) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      var node = sel.anchorNode;
      node = node && (node.nodeType === 1 ? node : node.parentElement);
      var blockEl = node && node.closest ? node.closest(".md-code-block") : null;
      if (!blockEl) return;
      var frag = sel.getRangeAt(0).cloneContents();
      e.clipboardData.setData("text/html", wrapCodeHtml(blockEl, frag));
      e.clipboardData.setData("text/plain", sel.toString());
      e.preventDefault();
    }

    function selectAndCopy(code) {
      var sel = window.getSelection();
      var saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      var range = document.createRange();
      range.selectNodeContents(code);
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      sel.removeAllRanges();
      if (saved) try { sel.addRange(saved); } catch (e) {}
      if (!ok && navigator.clipboard && window.ClipboardItem) {
        // 退路:异步写剪贴板(需要页面聚焦)
        var blockEl = code.closest(".md-code-block");
        navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([wrapCodeHtml(blockEl, code.cloneNode(true))], { type: "text/html" }),
          "text/plain": new Blob([code.innerText], { type: "text/plain" })
        })]).catch(function () {});
      }
    }

    function onClickCapture(e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-code-block-banner] button") : null;
      if (!btn) return;
      // 只接管复制按钮(横幅里可能还有其他按钮)
      var label = (btn.getAttribute("aria-label") || btn.textContent || "").trim();
      if (label && !/复制|copy/i.test(label)) return;
      var blockEl = btn.closest(".md-code-block");
      var code = blockEl ? blockEl.querySelector("pre code") : null;
      if (!code) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      selectAndCopy(code);
    }

    function apply(ctx) {
      if (typeof document === "undefined" || !document.body) return;
      var observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      document.addEventListener("copy", onCopyCapture, true);
      document.addEventListener("click", onClickCapture, true);
      schedule();
      // 调试入口:控制台里 window.dshRichCopy.rescan() 可手动触发(旧名保留兼容)
      window.dshRichCopy = { rescan: scan };
      window.etsHighlightRichCopy = window.dshRichCopy;
      if (ctx && typeof ctx.on === "function") {
        try {
          ctx.on("dispose", function () {
            observer.disconnect();
            document.removeEventListener("copy", onCopyCapture, true);
            document.removeEventListener("click", onClickCapture, true);
          });
        } catch (e) {}
      }
    }

    module.exports = { apply: apply };
    return module.exports;
  }
});