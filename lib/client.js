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

    var SHIKI_URLS = [
      "https://esm.sh/shiki@4.4.3",
      "https://cdn.jsdelivr.net/npm/shiki@4.4.3/+esm"
    ];
    var TARGET_LANGS = { ets: true, arkts: true };

    // 依次尝试可用的 ESM CDN,任一成功即可;全部失败才抛错。
    async function importShiki() {
      var lastError = null;
      for (var i = 0; i < SHIKI_URLS.length; i++) {
        try {
          return await import(SHIKI_URLS[i]);
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError || new Error("Shiki CDN 均不可用");
    }

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
          var shiki = await importShiki();
          // 颜色表示恒为 var(--shiki-*): createCssVariablesTheme 不可用时不再
          // 退回字面色主题 github-dark(那样 patchDecorators 的 FG_COLOR 判断与
          // resolveVarStyles 会静默失效), 直接失败让调用方走内置分词器兜底.
          if (typeof shiki.createCssVariablesTheme !== "function") {
            throw new Error("Shiki 缺少 createCssVariablesTheme, 无法保证颜色表示");
          }
          var theme = shiki.createCssVariablesTheme({
            name: "css-variables",
            variablePrefix: "--shiki-",
            fontStyle: true
          });
          var h = await shiki.createHighlighter({ themes: [theme], langs: ["typescript"] });
          await h.loadLanguage(Object.assign({}, GRAMMAR, { embeddedLangs: ["typescript"] }));
          return { h: h, themeName: "css-variables" };
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
      timer = setTimeout(function () { timer = null; scan(); scanDiffs(); }, 300);
    }

    // ── 防御性守护:止血外部 DOM 风暴 + 精确过滤自身扫描 ─────────────
    // 1. 止血 genui-dom-fence 空容器死循环:
    //    当会话中存在 `"panel": true` 的 dsh-ui 围栏时,genui 挂载的 <dg />
    //    正常渲染为 null(container.childElementCount === 0)。genui 的 ke()
    //    每帧把 childElementCount === 0 误判为"容器被宿主清空",不断卸载/删除/
    //    新建/插回 .genui-dom-fence,引发每秒数百次整页重排。
    //    这里在空容器实例上定义 childElementCount getter(当仍为空时返回 1),
    //    不插入任何真实 DOM 节点(零 React fiber 干扰),直接切断死循环。
    // 2. 精确过滤 MutationObserver:
    //    只当新增节点或变更目标涉及 .md-code-block / [data-diff] 时才调度扫描,
    //    彻底忽略鲸鱼挂件(dshwv-)、genui 围栏等无关高频 DOM 变更。
    var fenceGuardEnabled = true;
    var guardedFences = new WeakSet();
    var guardedFenceCount = 0;
    var guardedFenceEls = [];
    var nativeChildCountDesc = null;
    try {
      nativeChildCountDesc = Object.getOwnPropertyDescriptor(Element.prototype, "childElementCount");
    } catch (e) {}

    function guardFenceNode(el) {
      if (!fenceGuardEnabled || !el || guardedFences.has(el)) return;
      if (!el.classList || !el.classList.contains("genui-dom-fence")) return;
      guardedFences.add(el);
      try {
        var origGet = nativeChildCountDesc && nativeChildCountDesc.get;
        Object.defineProperty(el, "childElementCount", {
          configurable: true,
          get: function () {
            if (!fenceGuardEnabled) {
              return origGet ? origGet.call(this) : this.children.length;
            }
            var real = origGet ? origGet.call(this) : this.children.length;
            return real === 0 ? 1 : real;
          }
        });
        guardedFenceCount++;
        guardedFenceEls.push(el);
      } catch (e) {}
    }

    function sweepEmptyFences() {
      if (!fenceGuardEnabled || typeof document === "undefined") return;
      try {
        var list = document.querySelectorAll(".genui-dom-fence");
        for (var i = 0; i < list.length; i++) guardFenceNode(list[i]);
      } catch (e) {}
    }

    function isCodeOrDiffRelated(node) {
      if (!node) return false;
      var el = node.nodeType === 1 ? node : node.parentElement;
      if (!el || !el.closest) return false;
      if (el.closest(".md-code-block, [data-diff]")) return true;
      if (node.nodeType === 1 && el.querySelector) {
        if (el.querySelector(".md-code-block, [data-diff]")) return true;
      }
      return false;
    }

    function onMutations(records) {
      var needSchedule = false;
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (rec.type === "childList") {
          var added = rec.addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType === 1) {
              if (fenceGuardEnabled) {
                if (n.classList && n.classList.contains("genui-dom-fence")) {
                  guardFenceNode(n);
                } else if (n.querySelectorAll) {
                  var fences = n.querySelectorAll(".genui-dom-fence");
                  for (var f = 0; f < fences.length; f++) guardFenceNode(fences[f]);
                }
              }
              if (!needSchedule && isCodeOrDiffRelated(n)) needSchedule = true;
            }
          }
          if (!needSchedule && added.length > 0 && isCodeOrDiffRelated(rec.target)) {
            needSchedule = true;
          }
        } else if (rec.type === "characterData") {
          if (!needSchedule && isCodeOrDiffRelated(rec.target)) needSchedule = true;
        }
      }
      if (needSchedule) schedule();
    }

    // ── diff 卡的语法高亮 ─────────────────────────────────────
    // 宿主 DiffBlock 与 GenUI 的 diff 节点是同一个组件(容器固定带 data-diff),
    // 每行只是一段纯文本 div,不跑 Shiki。这里按路径后缀推断语言,把连续的
    // 代码行整段交给 Shiki,再按行回填 token;行底色与红绿语义仍归宿主。
    var LANG_BY_EXT = {
      ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript",
      js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
      kt: "kotlin", kts: "kotlin",
      java: "java", py: "python", go: "go", rs: "rust",
      cs: "csharp", c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp",
      php: "php", rb: "ruby", swift: "swift",
      yaml: "yaml", yml: "yaml", json: "json", jsonc: "json",
      sql: "sql", md: "markdown", html: "html", htm: "html",
      css: "css", scss: "scss", less: "less", xml: "xml", lua: "lua",
      sh: "shellscript", bash: "shellscript", zsh: "shellscript",
      ets: "ArkTS", arkts: "ArkTS"
    };
    var KNOWN_LANGS = {
      typescript: 1, javascript: 1, tsx: 1, jsx: 1, kotlin: 1, java: 1,
      python: 1, go: 1, rust: 1, csharp: 1, c: 1, cpp: 1, php: 1, ruby: 1,
      swift: 1, yaml: 1, json: 1, sql: 1, markdown: 1, html: 1, css: 1,
      scss: 1, less: 1, xml: 1, lua: 1, shellscript: 1
    };
    var DIFF_MAX_LINES = 400;
    var diffEnabled = true;
    var diffScanning = false;
    var lastDiffError = null;
    var builtinMode = false;

    // 卡片自带的语言标签(header 里的 `kotlin`)优先于路径后缀推断。
    function langFromHeading(text) {
      var t = (text || "").trim().toLowerCase();
      if (!t) return null;
      if (t === "ets" || t === "arkts") return "ArkTS";
      if (t === "sh" || t === "bash") return "shellscript";
      if (KNOWN_LANGS[t]) return t;
      return LANG_BY_EXT[t] || null;
    }

    function langForPath(path) {
      var m = /\.([A-Za-z0-9]+)$/.exec((path || "").trim());
      if (!m) return null;
      return LANG_BY_EXT[m[1].toLowerCase()] || null;
    }

    function escapeHtml(text) {
      return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function firstDivChild(el) {
      var kids = el.children;
      for (var i = 0; i < kids.length; i++) if (kids[i].tagName === "DIV") return kids[i];
      return null;
    }

    // 真实卡片结构:`_card_` 里是 `_header_`/`_heading_`/`_actions_`/`_body_`,
    // 行都在 `_body_` 下。没有这套类名时退回宿主 DiffBlock 的"首个子 div"。
    function findDiffBody(block) {
      var body = block.querySelector('[class*="_body_"]');
      return body || firstDivChild(block);
    }

    function diffRowsOf(body) {
      var out = [];
      var kids = body.children;
      for (var i = 0; i < kids.length; i++) if (kids[i].tagName === "DIV") out.push(kids[i]);
      return out;
    }

    function rowKind(row, isFirst) {
      // 真实卡片用哈希类名(_line_1cyuy_13 _del_1cyuy_38),按前缀匹配;
      // 宿主 DiffBlock 的裸类名 del/add 一并兼容。
      var cls = " " + (row.className || "") + " ";
      if (/_path_/.test(cls)) return "path";
      if (/_del_/.test(cls)) return "del";
      if (/_add_/.test(cls)) return "add";
      if (/_context_/.test(cls)) return "context";
      if (/_gap_/.test(cls)) return "gap";
      if (/\bdel\b/.test(cls)) return "del";
      if (/\badd\b/.test(cls)) return "add";
      if (/\bpath\b/.test(cls)) return "path";
      if (/\bgap\b/.test(cls)) return "gap";
      if ((row.textContent || "").trim() === "⋯") return "gap";
      if (isFirst) return "path";
      return "";
    }

    function bgTint(el) {
      try { return getComputedStyle(el).backgroundColor || ""; } catch (e) { return ""; }
    }

    function solidBg(el) {
      var e = el;
      while (e && e !== document.body && e !== document.documentElement) {
        var c = getComputedStyle(e).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
        e = e.parentElement;
      }
      return "transparent";
    }

    // 连续代码行成段(行类名缺失时靠背景色变化切段),段内整体着色后按行回填。
    function colorizeDiffRows(rows, lang, pack) {
      var segments = [];
      var current = null;
      var lastKey = null;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var kind = rowKind(row, i === 0);
        if (kind === "path" || kind === "gap") { current = null; lastKey = null; continue; }
        // 分段:有 kind 时 del/context/add 各自成段,否则按行背景色切段
        var key = kind || bgTint(row);
        if (!current || key !== lastKey) {
          current = [];
          segments.push(current);
          lastKey = key;
        }
        current.push(row);
      }
      for (var s = 0; s < segments.length; s++) {
        var seg = segments[s];
        if (!seg.length) continue;
        var text = seg.map(function (r) { return r.textContent; }).join("\n");
        var tokens = null;
        try {
          tokens = pack.h.codeToTokens(text, { lang: lang, theme: pack.themeName }).tokens;
        } catch (e) { tokens = null; }
        for (var j = 0; j < seg.length; j++) {
          var el = seg[j];
          var line = tokens && tokens[j];
          if (line) {
            var html = "";
            for (var k = 0; k < line.length; k++) {
              var token = line[k];
              var style = token.color ? ' style="color:' + token.color + '"' : "";
              html += "<span" + style + ">" + escapeHtml(token.content) + "</span>";
            }
            el.innerHTML = html;
          }
          el.setAttribute("data-dsh-colored", "1");
        }
      }
    }

    async function ensureDiffLang(pack, lang) {
      if (!lang) return false;
      if (lang === "ArkTS") return true; // getHighlighter 里已加载
      var h = pack.h;
      var loaded = h.getLoadedLanguages ? h.getLoadedLanguages() : [];
      if (loaded && loaded.indexOf(lang) !== -1) return true;
      var loader = h.loadLanguage || h.loadLanguages;
      if (!loader) {
        lastDiffError = "loadLanguage 不可用";
        return false;
      }
      try {
        await loader.call(h, lang);
        return true;
      } catch (e) {
        lastDiffError = "加载 " + lang + " 失败: " + (e && e.message ? e.message : String(e));
        return false;
      }
    }

    // ── 零网络兜底高亮 ───────────────────────────────────────
    // CDN 不可用或 Shiki 初始化失败时,用极简正则给 diff 行上色。
    // 覆盖注释/字符串/注解/数字/关键字/类型/函数名;颜色取宿主 --shiki-* 变量,
    // 未定义时退回内置色值,因此仍跟随明暗主题。
    var BUILTIN_KEYWORDS = "abstract|actual|annotation|as|assert|async|await|break|by|catch|class|companion|const|constructor|continue|data|default|delegate|do|else|enum|expect|export|extends|external|false|field|file|final|finally|for|fun|get|if|import|in|init|inline|inner|interface|internal|is|it|lateinit|let|match|mod|mut|new|null|object|open|operator|out|override|package|private|protected|pub|public|readonly|record|reified|return|sealed|set|static|struct|super|suspend|switch|this|throw|throws|true|try|type|typealias|typeof|val|var|void|when|where|while|with|yield";
    var BUILTIN_COLORS = {
      comment: "var(--shiki-token-comment, #6a737d)",
      string: "var(--shiki-token-string, #a31515)",
      number: "var(--shiki-token-constant, #098658)",
      keyword: "var(--shiki-token-keyword, #0000ff)",
      type: "var(--shiki-token-type, #267f99)",
      func: "var(--shiki-token-function, #795e26)",
      annotation: "var(--shiki-token-function, #9a6700)"
    };
    var BUILTIN_RE = new RegExp(
      "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)" +
      "|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)" +
      "|(@[A-Za-z_][\\w.]*)" +
      "|\\b(\\d+(?:\\.\\d+)?[fFlLdD]?)\\b" +
      "|\\b(" + BUILTIN_KEYWORDS + ")\\b" +
      "|\\b([A-Z][A-Za-z0-9_]*)\\b" +
      "|\\b([a-zA-Z_]\\w*)(?=\\s*\\()",
      "g"
    );

    function builtinLineHtml(line) {
      var html = "";
      var last = 0;
      var m;
      BUILTIN_RE.lastIndex = 0;
      while ((m = BUILTIN_RE.exec(line))) {
        if (m.index > last) html += escapeHtml(line.slice(last, m.index));
        var text = m[0];
        var color = null;
        if (m[1]) color = BUILTIN_COLORS.comment;
        else if (m[2]) color = BUILTIN_COLORS.string;
        else if (m[3]) color = BUILTIN_COLORS.annotation;
        else if (m[4]) color = BUILTIN_COLORS.number;
        else if (m[5]) color = BUILTIN_COLORS.keyword;
        else if (m[6]) color = BUILTIN_COLORS.type;
        else if (m[7]) color = BUILTIN_COLORS.func;
        if (color) html += '<span style="color:' + color + '">' + escapeHtml(text) + "</span>";
        else html += escapeHtml(text);
        last = m.index + text.length;
        if (text.length === 0) BUILTIN_RE.lastIndex++;
      }
      html += escapeHtml(line.slice(last));
      return html;
    }

    function colorizeDiffRowsBuiltin(rows) {
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var kind = rowKind(row, i === 0);
        if (kind === "path" || kind === "gap") continue;
        if (row.getAttribute("data-dsh-colored") === "1") continue;
        try {
          row.innerHTML = builtinLineHtml(row.textContent || "");
        } catch (e) {}
        row.setAttribute("data-dsh-colored", "1");
      }
    }

    async function scanDiffs() {
      if (!diffEnabled || diffScanning || typeof document === "undefined") return;
      diffScanning = true;
      try {
        var blocks = document.querySelectorAll("[data-diff]");
        for (var i = 0; i < blocks.length; i++) {
          var block = blocks[i];
          if (!block.isConnected) continue;
          var body = findDiffBody(block);
          if (!body) continue;
          var rows = diffRowsOf(body);
          if (!rows.length) continue;
          if (rows.length > DIFF_MAX_LINES) continue;
          var pending = false;
          for (var r = 0; r < rows.length; r++) {
            if (rows[r].getAttribute("data-dsh-colored") !== "1") { pending = true; break; }
          }
          if (!pending) continue;
          // 先立即上色:不依赖网络,任何环境下都有颜色
          colorizeDiffRowsBuiltin(rows);
        }
      } finally {
        diffScanning = false;
      }
      // Shiki 只做后台升级,成功才覆盖内置结果
      upgradeDiffWithShiki();
    }

    function withTimeout(promise, ms) {
      return Promise.race([
        promise,
        new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error("超时 " + ms + "ms")); }, ms);
        })
      ]);
    }

    var shikiUpgradeStarted = false;
    var shikiUpgraded = false;
    var resolvedPack = null;

    function detectDiffLang(block, rows) {
      var heading = block.querySelector('[class*="_heading_"]');
      var lang = langFromHeading(heading ? heading.textContent : "");
      if (!lang && rows && rows.length) {
        var pathText = (rows[0].textContent || "").trim().split(/[:(]/)[0];
        lang = langForPath(pathText);
      }
      return lang;
    }

    // 同步对单个 diff 块立即上色(用于展开按钮点击或复制前自动展开):
    // 先用内置分词器秒上色保证零延迟;若 Shiki 语言已就绪则直接用 Shiki 覆盖。
    function colorizeOneDiffBlockSync(block) {
      if (!diffEnabled || !block) return;
      var body = findDiffBody(block);
      if (!body) return;
      var rows = diffRowsOf(body);
      if (!rows.length || rows.length > DIFF_MAX_LINES) return;
      colorizeDiffRowsBuiltin(rows);
      var lang = detectDiffLang(block, rows);
      if (resolvedPack && lang) {
        var h = resolvedPack.h;
        var loaded = h && h.getLoadedLanguages ? h.getLoadedLanguages() : [];
        if (lang === "ArkTS" || (loaded && loaded.indexOf(lang) !== -1)) {
          colorizeDiffRows(rows, lang, resolvedPack);
        } else {
          ensureDiffLang(resolvedPack, lang).then(function (ok) {
            if (ok) colorizeDiffRows(diffRowsOf(body), lang, resolvedPack);
          });
        }
      }
    }

    async function upgradeDiffWithShiki() {
      if (shikiUpgradeStarted || shikiUpgraded || builtinMode || !diffEnabled) return;
      shikiUpgradeStarted = true;
      var pack;
      try {
        pack = await withTimeout(getHighlighter(), 12000);
        resolvedPack = pack;
      } catch (e) {
        builtinMode = true;
        lastDiffError = "Shiki 不可用: " + (e && e.message ? e.message : String(e));
        return;
      }
      var okAny = false;
      try {
        var blocks = document.querySelectorAll("[data-diff]");
        for (var i = 0; i < blocks.length; i++) {
          var block = blocks[i];
          var body = findDiffBody(block);
          if (!body) continue;
          var rows = diffRowsOf(body);
          if (!rows.length || rows.length > DIFF_MAX_LINES) continue;
          var lang = detectDiffLang(block, rows);
          if (!lang) continue;
          if (!(await ensureDiffLang(pack, lang))) continue;
          colorizeDiffRows(rows, lang, pack);
          okAny = true;
        }
      } catch (e) {
        lastDiffError = "Shiki 着色失败: " + (e && e.message ? e.message : String(e));
      }
      if (okAny) {
        shikiUpgraded = true;
        lastDiffError = null;
      } else {
        shikiUpgradeStarted = false; // 下次扫描再试
      }
    }

    // 从 DiffBlock 容器的 React fiber 中提取 memoizedState 里的完整行数组 [{kind, text}]。
    // 当 diff 卡处于折叠状态且 React 18 尚未异步提交 expand 状态时,
    // 用它在点击栈内同步构建全量行,避免同步 execCommand("copy") 只拿到折叠前的 16 行。
    function extractFullDiffRowsFromFiber(block) {
      if (!block) return null;
      try {
        var keys = Object.keys(block);
        var fKey = null;
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].indexOf("__reactFiber$") === 0 || keys[i].indexOf("__reactInternalInstance$") === 0) {
            fKey = keys[i];
            break;
          }
        }
        if (!fKey) return null;
        var cur = block[fKey];
        for (var step = 0; cur && step < 10; step++, cur = cur.return) {
          var ms = cur.memoizedState;
          for (var h = 0; ms && h < 10; h++, ms = ms.next) {
            var val = ms.memoizedState;
            var arr = Array.isArray(val) ? val[0] : (val && Array.isArray(val.rows) ? val.rows : null);
            if (Array.isArray(arr) && arr.length > 0 && arr[0] && typeof arr[0].kind === "string" && typeof arr[0].text === "string") {
              return arr;
            }
          }
        }
      } catch (e) {}
      return null;
    }

    function buildFullDiffFragmentFromFiber(block, rawRows) {
      var frag = document.createDocumentFragment();
      var domRows = [];
      for (var i = 0; i < rawRows.length; i++) {
        var r = rawRows[i];
        var d = document.createElement("div");
        d.className = "_line_ _" + r.kind + "_";
        d.textContent = r.text;
        frag.appendChild(d);
        domRows.push(d);
      }
      if (diffEnabled && domRows.length <= DIFF_MAX_LINES) {
        colorizeDiffRowsBuiltin(domRows);
        var lang = detectDiffLang(block, domRows);
        if (resolvedPack && lang) {
          var h = resolvedPack.h;
          var loaded = h && h.getLoadedLanguages ? h.getLoadedLanguages() : [];
          if (lang === "ArkTS" || (loaded && loaded.indexOf(lang) !== -1)) {
            colorizeDiffRows(domRows, lang, resolvedPack);
          }
        }
      }
      return frag;
    }

    // diff 的纯文本复制保持宿主格式:删除行 `- `、新增行 `+ `、上下文行 `  `、路径与 gap 原样。
    function diffCopyText(block) {
      var fiberRows = extractFullDiffRowsFromFiber(block);
      if (fiberRows && fiberRows.length) {
        var fout = [];
        for (var f = 0; f < fiberRows.length; f++) {
          var fk = fiberRows[f].kind;
          var ft = fiberRows[f].text || "";
          if (fk === "del") fout.push("- " + ft);
          else if (fk === "add") fout.push("+ " + ft);
          else if (fk === "context") fout.push("  " + ft);
          else fout.push(ft);
        }
        return fout.join("\n");
      }
      var body = findDiffBody(block);
      var rows = body ? diffRowsOf(body) : [];
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var kind = rowKind(rows[i], i === 0);
        var text = rows[i].textContent || "";
        if (kind === "del") out.push("- " + text);
        else if (kind === "add") out.push("+ " + text);
        else if (kind === "context") out.push("  " + text);
        else out.push(text);
      }
      return out.join("\n");
    }

    // 把半透明颜色叠到不透明底色上,得到不透明实色。
    // 粘贴目标(如 Snipaste 的富文本引擎)会把 div 的背景同时铺到整行和行内文字上,
    // 半透明色叠两层就出现"文字背后更深一块"的色阶;实色叠几层都一样。
    var blendCanvas = null;
    function blendOver(base, tint) {
      try {
        if (!blendCanvas) {
          blendCanvas = document.createElement("canvas");
          blendCanvas.width = 1;
          blendCanvas.height = 1;
        }
        var g = blendCanvas.getContext("2d", { willReadFrequently: true });
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = base;
        g.fillRect(0, 0, 1, 1);
        g.fillStyle = tint;
        g.fillRect(0, 0, 1, 1);
        var d = g.getImageData(0, 0, 1, 1).data;
        return "rgb(" + d[0] + ", " + d[1] + ", " + d[2] + ")";
      } catch (e) {
        return tint;
      }
    }

    function isClearColor(c) {
      return !c || c === "transparent" || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(c);
    }

    function wrapDiffHtml(block, fragment) {
      // 展开/收起按钮不进剪贴板
      var buttons = fragment.querySelectorAll ? fragment.querySelectorAll("button") : [];
      for (var b = buttons.length - 1; b >= 0; b--) {
        if (buttons[b].parentNode) buttons[b].parentNode.removeChild(buttons[b]);
      }
      var base = solidBg(block);
      var body = findDiffBody(block);
      // 行底色只从原卡片按行类型各取一次(只读,不触发重排),
      // 不再对克隆出来的每一行反复读写样式。
      var tints = Object.create(null);
      var live = body ? diffRowsOf(body) : [];
      for (var i = 0; i < live.length; i++) {
        var lk = rowKind(live[i], i === 0);
        if (lk !== "add" && lk !== "del") continue;
        if (lk in tints) continue;
        var t = bgTint(live[i]);
        if (isClearColor(t)) t = lk === "add" ? "rgba(46, 160, 67, 0.15)" : "rgba(248, 81, 73, 0.15)";
        tints[lk] = blendOver(base, t);
        if ("add" in tints && "del" in tints) break;
      }
      if (!("add" in tints)) tints.add = blendOver(base, "rgba(46, 160, 67, 0.15)");
      if (!("del" in tints)) tints.del = blendOver(base, "rgba(248, 81, 73, 0.15)");
      var lines = fragment.querySelectorAll("div");
      for (var j = 0; j < lines.length; j++) {
        var lineEl = lines[j];
        var kind = rowKind(lineEl, j === 0);
        if (kind === "add" || kind === "del") lineEl.style.backgroundColor = tints[kind];
        // 宿主行首的 "- " / "+ " / "  " 是用 CSS ::before 画的,不在 DOM 文本里;
        // 复制到外部(如 Snipaste)时显式补齐前缀 span,保证符号与缩进对齐一致。
        if (!lineEl.querySelector("[data-dsh-diff-prefix]")) {
          var prefixText = kind === "del" ? "- " : (kind === "add" ? "+ " : (kind === "context" ? "  " : ""));
          if (prefixText) {
            var pSpan = document.createElement("span");
            pSpan.setAttribute("data-dsh-diff-prefix", "1");
            if (kind === "del") pSpan.style.color = "#cf222e";
            else if (kind === "add") pSpan.style.color = "#1a7f37";
            pSpan.textContent = prefixText;
            lineEl.insertBefore(pSpan, lineEl.firstChild);
          }
        }
      }
      resolveVarStyles(fragment, block);

      var cs = body ? getComputedStyle(body) : null;
      var wrap = document.createElement("div");
      wrap.style.background = base;
      wrap.style.color = (cs ? cs.color : "") || "#000";
      wrap.style.fontFamily = cleanCodeFontStack(cs ? cs.fontFamily : "");
      wrap.style.fontSize = (cs ? cs.fontSize : "") || "12px";
      wrap.style.lineHeight = (cs ? cs.lineHeight : "") || "1.6";
      wrap.style.fontWeight = (cs && cs.fontWeight) ? cs.fontWeight : "500";
      wrap.style.padding = "8px 12px";
      wrap.style.borderRadius = "6px";
      wrap.style.whiteSpace = "pre";
      wrap.style.overflowX = "auto";
      wrap.appendChild(fragment);
      return wrap.outerHTML;
    }
    // 选区是否完整覆盖 body(起点不晚于、终点不早于 body 的范围)。
    // 不能用 Selection.containsNode(body, true):partialContainment 语义下
    // 只要有一点点重叠就返回 true,导致选区复制退化成整块复制。
    function selectionCoversBody(sel, body) {
      if (!sel || !sel.rangeCount) return false;
      var range = sel.getRangeAt(0);
      var bodyRange = document.createRange();
      bodyRange.selectNodeContents(body);
      try {
        return range.compareBoundaryPoints(Range.START_TO_START, bodyRange) <= 0 &&
               range.compareBoundaryPoints(Range.END_TO_END, bodyRange) >= 0;
      } catch (e) {
        return false;
      }
    }

    // ── L1 复制编排: 一个 deep module ────────────────────────────
    // interface: 给定 CopySource 与 CopyTrigger,产出 ClipboardPayload 并写入剪贴板.
    //   payload(source)     只产出 {html, text},供调试与测试断言
    //   copyButton(source)  按钮触发
    //   copyCapture(e)      选区触发(Ctrl+C)的 copy 事件入口
    //   suppressHostWrite() 抑制宿主紧随的纯文本覆盖
    //   dispose()           唯一生命周期回收点
    // implementation 内部持有两个真实 adapter(CodeBlock / DiffCard),写入侧
    // (1 字符 dummy + execCommand + copy 事件握手),pending 状态与宿主补丁.
    // 宿主 DOM 识别与写入细节都不越过这个 seam.
    var clipboard = (function () {
      var pending = null;
      var suppressTimer = null;
      var origWriteText = null;

      // 两个真实 adapter: 代码块与 diff 卡各产出一份自包含 ClipboardPayload.
      function payload(source) {
        if (source.kind === "diff") {
          return { html: wrapDiffHtml(source.el, source.fragment), text: source.text };
        }
        return { html: wrapCodeHtml(source.el, source.fragment), text: source.text };
      }

      // 写入侧留在 implementation 内,不注入替身:
      // 在点击栈内只选中屏外 1 字符隐藏节点,同步 execCommand 触发 copy 事件,
      // 由 copyCapture 把 pending 的 payload 写入 clipboardData.
      function writeSync(p) {
        if (!p || !p.html) return false;
        pending = p;
        var dummy = document.createElement("span");
        dummy.textContent = ".";
        dummy.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;user-select:text;-webkit-user-select:text;";
        document.body.appendChild(dummy);
        var sel = window.getSelection();
        var saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        var range = document.createRange();
        range.selectNodeContents(dummy);
        sel.removeAllRanges();
        sel.addRange(range);
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        var handled = pending === null;
        pending = null;
        sel.removeAllRanges();
        if (saved) try { sel.addRange(saved); } catch (e) {}
        if (dummy.parentNode) dummy.parentNode.removeChild(dummy);
        return ok && handled;
      }

      // 大选区回退: 只在 writeSync 失败时走原始选区序列化.
      function fallbackSelect(source) {
        if (!source.selectNode) return;
        var sel = window.getSelection();
        var saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        var range = document.createRange();
        range.selectNodeContents(source.selectNode);
        sel.removeAllRanges();
        sel.addRange(range);
        try { document.execCommand("copy"); } catch (e) {}
        sel.removeAllRanges();
        if (saved) try { sel.addRange(saved); } catch (e) {}
      }

      function copyButton(source) {
        try {
          if (writeSync(payload(source))) return;
        } catch (e) {}
        fallbackSelect(source);
      }

      function suppressHostWrite() {
        try {
          if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
          if (!origWriteText) origWriteText = navigator.clipboard.writeText;
          navigator.clipboard.writeText = function () { return Promise.resolve(); };
          if (suppressTimer) clearTimeout(suppressTimer);
          suppressTimer = setTimeout(restoreWriteText, 250);
        } catch (e) {}
      }

      function restoreWriteText() {
        suppressTimer = null;
        try {
          if (origWriteText && navigator.clipboard) navigator.clipboard.writeText = origWriteText;
        } catch (e) {}
      }

      // 选区路径: 从当前 Selection 构造 CopySource,不再单独写一套 setData.
      function sourceFromSelection() {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
        var node = sel.anchorNode;
        node = node && (node.nodeType === 1 ? node : node.parentElement);
        var target = codeContainerOf(node);
        if (!target) return null;
        var frag = sel.getRangeAt(0).cloneContents();
        if (target.kind === "diff") {
          var body = findDiffBody(target.el);
          var whole = body ? selectionCoversBody(sel, body) : false;
          return {
            kind: "diff", el: target.el, fragment: frag,
            text: whole ? diffCopyText(target.el) : sel.toString(),
            selectNode: body
          };
        }
        return {
          kind: "code", el: target.el, fragment: frag,
          text: sel.toString(),
          selectNode: target.el.querySelector("pre code")
        };
      }

      function copyCapture(e) {
        if (pending) {
          e.clipboardData.setData("text/html", pending.html);
          e.clipboardData.setData("text/plain", pending.text);
          pending = null;
          e.preventDefault();
          return;
        }
        var source = sourceFromSelection();
        if (!source) return;
        var p = payload(source);
        e.clipboardData.setData("text/html", p.html);
        e.clipboardData.setData("text/plain", p.text);
        e.preventDefault();
      }

      function dispose() {
        if (suppressTimer) clearTimeout(suppressTimer);
        restoreWriteText();
        pending = null;
      }

      return {
        payload: payload,
        copyButton: copyButton,
        copyCapture: copyCapture,
        suppressHostWrite: suppressHostWrite,
        dispose: dispose
      };
    })();

    // ── 富文本复制 ─────────────────────────────────────────────
    // DSH 代码块用 css-variables 主题,颜色是 var(--shiki-token-*)。
    // 直接 cloneContents() 会把未解析的 var() 带进剪贴板 HTML,
    // 离开 DSH 后变量失效 -> 黑字透明底(Snipaste 症状)。
    // 修复:把克隆片段临时挂回真实 DOM,用 getComputedStyle 把每个
    // var(...) 解析回字面 rgb 再序列化,得到自包含 HTML。
    // 解析 var(...) 为字面颜色:优先从 scope 元素(原卡片)读变量值,
    // 克隆片段一旦离开原 DOM 子树,组件级 CSS 变量就可能不可见。
    // 同一个卡片内的 CSS 变量只读一次;长代码复制时这个缓存是性能关键
    var cssVarCache = null;
    var cssVarScope = null;
    function readCssVar(scopeEl, name) {
      if (!scopeEl) return "";
      if (cssVarScope !== scopeEl) {
        cssVarScope = scopeEl;
        cssVarCache = Object.create(null);
      }
      if (name in cssVarCache) return cssVarCache[name];
      var v = "";
      try { v = getComputedStyle(scopeEl).getPropertyValue(name).trim(); } catch (e) {}
      cssVarCache[name] = v;
      return v;
    }

    function resolveColorValue(raw, scopeEl) {
      var m = /var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/.exec(raw || "");
      if (!m) return "";
      var v = readCssVar(scopeEl, m[1]);
      if (!v && m[2]) v = m[2].trim();
      // 变量读不到时按 token 名兜底,避免整行退化成黑色
      if (!v) {
        if (/keyword|operator/.test(m[1])) v = "#0000ff";
        else if (/string/.test(m[1])) v = "#a31515";
        else if (/comment/.test(m[1])) v = "#6a737d";
        else if (/constant|number/.test(m[1])) v = "#098658";
        else if (/type|class|namespace/.test(m[1])) v = "#267f99";
        else if (/function|method/.test(m[1])) v = "#795e26";
      }
      return v || "";
    }

    // 解析 light-dark(a, b):按当前是否暗色主题取其一(不需要挂载到 DOM)
    function resolveLightDark(raw, scopeEl) {
      var m = /light-dark\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/.exec(raw || "");
      if (!m) return "";
      var dark = false;
      try { dark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
      try {
        var scheme = getComputedStyle(scopeEl).colorScheme || "";
        if (/\bdark\b/.test(scheme) && !/\blight\b/.test(scheme)) dark = true;
        else if (/\blight\b/.test(scheme) && !/\bdark\b/.test(scheme)) dark = false;
      } catch (e) {}
      var pick = dark ? m[2] : m[1];
      return /var\(/.test(pick) ? resolveColorValue(pick, scopeEl) : pick;
    }

    // 克隆片段不必挂回 DOM:变量一律从原卡片(scopeEl)读,每个变量只读一次。
    // 之前挂载几千个 span 再读样式会触发整块强制布局,这是复制卡顿的来源。
    function resolveVarStyles(root, scopeEl) {
      // 缓存只在单次复制内有效: 明暗主题切换后同一 scopeEl 的 --shiki-* 值会变,
      // 若缓存跨复制存活, 复制出的 HTML 会带旧主题的字面颜色.
      cssVarCache = null;
      cssVarScope = null;
      var targets = root.querySelectorAll('[style*="var("], [style*="light-dark("]');
      for (var i = 0; i < targets.length; i++) {
        var style = targets[i].style;
        if (!style) continue;
        try {
          var color = style.color;
          if (color && color.indexOf("var(") !== -1) {
            var v = resolveColorValue(color, scopeEl);
            if (v) style.color = v;
          } else if (color && color.indexOf("light-dark(") !== -1) {
            var l = resolveLightDark(color, scopeEl);
            if (l) style.color = l;
          }
          var bg = style.backgroundColor;
          if (bg && bg.indexOf("var(") !== -1) {
            var bv = resolveColorValue(bg, scopeEl);
            if (bv) style.backgroundColor = bv;
          } else if (bg && bg.indexOf("light-dark(") !== -1) {
            var bl = resolveLightDark(bg, scopeEl);
            if (bl) style.backgroundColor = bl;
          }
        } catch (e) {}
      }
    }
    // 清理代码字体栈:
    // 1. dsh-claude-style 在 <pre>/<code> 上设置了 "Anthropic Mono Web","JetBrains Mono","Noto Sans SC",...
    //    其中前几个是页面内 @font-face Web 字体(外部软件如 Snipaste 没有安装),
    //    且中文字体排在 Consolas 前面,或因 Qt RichText 对 <pre><code> 默认重置为 Courier New/SimSun,
    //    导致粘贴出的代码块变成细宋体/Courier New,与 diff 卡(Consolas + Microsoft YaHei)字体不一致。
    // 2. 这里剔除仅页面内存在的 Web 字体名并保证英文优先走 JetBrains Mono / Consolas,
    //    中文回退走 Microsoft YaHei,同时代码块外层与 diff 卡统一用 <div> 容器避免 <pre><code> 被重置。
    var FALLBACK_CODE_FONT = '"JetBrains Mono", Consolas, "Fira Code", "SF Mono", Menlo, "Microsoft YaHei", monospace';
    function cleanCodeFontStack(raw) {
      if (!raw) return FALLBACK_CODE_FONT;
      var parts = raw.split(",");
      var keep = [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        var unq = p.replace(/^["']|["']$/g, "").trim();
        if (!unq) continue;
        // 剔除页面内私有 Web 字体与排在等宽字体前面的中文字体,统一把中文字体放到等宽字体之后
        if (/^(Anthropic|Claude Style|ui-monospace|-apple-system|BlinkMacSystemFont|Noto Sans|Source Han|PingFang|Hiragino|Microsoft YaHei|Courier$)/i.test(unq)) {
          continue;
        }
        keep.push(p);
      }
      var joined = keep.join(", ");
      if (!/Consolas/i.test(joined)) keep.unshift("Consolas");
      if (!/JetBrains Mono/i.test(joined)) keep.unshift('"JetBrains Mono"');
      keep.push('"Microsoft YaHei"', "monospace");
      return keep.join(", ");
    }

    function wrapCodeHtml(blockEl, fragment) {
      // 不挂载到 DOM:变量从原代码块读取并缓存,避免对几千个 span 强制布局
      var tmp = document.createElement("div");
      tmp.appendChild(fragment);
      // 若克隆片段最外层是 <code>,拆掉 <code> 壳保留内部行,避免粘贴目标(Qt RichText)
      // 对 <code>/<pre> 应用内置的 Courier New / 宋体覆盖外层 font-family
      if (tmp.childNodes.length === 1 && tmp.firstChild.nodeType === 1 && tmp.firstChild.tagName === "CODE") {
        var codeNode = tmp.firstChild;
        while (codeNode.firstChild) tmp.insertBefore(codeNode.firstChild, codeNode);
        tmp.removeChild(codeNode);
      }
      resolveVarStyles(tmp, blockEl);
      var innerHtml = tmp.innerHTML;

      // 与 diff 序列化器共用同一个祖先实色背景扫描
      var bg = solidBg(blockEl);

      var codeEl = blockEl ? (blockEl.querySelector("pre code") || blockEl.querySelector("pre")) : null;
      var pcs = codeEl ? getComputedStyle(codeEl) : null;
      var fontStack = cleanCodeFontStack(pcs ? pcs.fontFamily : "");
      var wrap = document.createElement("div");
      wrap.style.background = bg;
      wrap.style.color = (pcs ? pcs.color : "") || "#000";
      wrap.style.padding = "12px 16px";
      wrap.style.borderRadius = "6px";
      wrap.style.fontFamily = fontStack;
      wrap.style.fontSize = (pcs ? pcs.fontSize : "") || "13px";
      wrap.style.lineHeight = (pcs ? pcs.lineHeight : "") || "1.6";
      wrap.style.fontWeight = (pcs && pcs.fontWeight) ? pcs.fontWeight : "500";
      wrap.style.whiteSpace = "pre";
      wrap.innerHTML = innerHtml;
      return wrap.outerHTML;
    }

    function codeContainerOf(node) {
      if (!node || !node.closest) return null;
      var diff = node.closest("[data-diff]");
      if (diff) return { kind: "diff", el: diff };
      var code = node.closest(".md-code-block");
      if (code) return { kind: "code", el: code };
      return null;
    }

    function onClickCapture(e) {
      if (!e.target || !e.target.closest) return;
      var codeBtn = e.target.closest("[data-code-block-banner] button");
      // diff 卡的头部同样带 data-code-block-banner,必须排除,交给下面的 diff 分支
      if (codeBtn && !codeBtn.closest("[data-diff]")) {
        // 排除"自动换行"按钮(带 aria-pressed 属性),其余是复制按钮
        if (codeBtn.hasAttribute("aria-pressed")) return;
        var label = (codeBtn.getAttribute("aria-label") || codeBtn.textContent || "").trim();
        if (label && !/复制|复制成功|copy|copied/i.test(label)) return;
        var blockEl = codeBtn.closest(".md-code-block");
        var code = blockEl ? blockEl.querySelector("pre code") : null;
        if (!code) return;
        clipboard.suppressHostWrite();
        clipboard.copyButton({
          kind: "code", el: blockEl, fragment: code.cloneNode(true),
          text: code.textContent || "", selectNode: code
        });
        return;
      }
      var diffBtn = e.target.closest("[data-diff] button");
      if (!diffBtn) return;
      var diffBlock = diffBtn.closest("[data-diff]");
      // 手动点击"… 其余 N 行"展开按钮:下一帧立即给新插入的行同步上色,消除黑白闪烁
      if (diffBtn.hasAttribute("aria-expanded")) {
        if (diffBtn.getAttribute("aria-expanded") === "false" && diffBlock) {
          requestAnimationFrame(function () { colorizeOneDiffBlockSync(diffBlock); });
        }
        return;
      }
      // 排除"自动换行"按钮(带 aria-pressed 属性),其余是复制按钮
      if (diffBtn.hasAttribute("aria-pressed")) return;
      var text = (diffBtn.getAttribute("aria-label") || diffBtn.getAttribute("title") || diffBtn.textContent || "").trim();
      if (text && !/复制|复制成功|copy|copied/i.test(text)) return;
      var diffBody = diffBlock ? findDiffBody(diffBlock) : null;
      if (!diffBody) return;
      clipboard.suppressHostWrite();
      // 若当前 diff 卡处于折叠状态,先自动触发展开按钮(保持展开)
      var expandBtn = diffBlock.querySelector('button[aria-expanded="false"]');
      if (expandBtn) {
        try { expandBtn.click(); } catch (err) {}
      }
      var bodyNow = findDiffBody(diffBlock) || diffBody;
      colorizeOneDiffBlockSync(diffBlock);
      // 折叠态从 React fiber 同步构造全量行,避免只拿到折叠前的 16 行
      var fiberRows = extractFullDiffRowsFromFiber(diffBlock);
      var frag = (fiberRows && fiberRows.length > diffRowsOf(bodyNow).length)
        ? buildFullDiffFragmentFromFiber(diffBlock, fiberRows)
        : bodyNow.cloneNode(true);
      clipboard.copyButton({
        kind: "diff", el: diffBlock, fragment: frag,
        text: diffCopyText(diffBlock), selectNode: bodyNow
      });
      // 若 React 18 批处理在下一帧才插入展开后的中间行,下一帧立即补齐染色
      if (expandBtn) {
        requestAnimationFrame(function () { colorizeOneDiffBlockSync(diffBlock); });
      }
    }

    function apply(ctx) {
      if (typeof document === "undefined" || !document.body) return;
      sweepEmptyFences();
      var observer = new MutationObserver(onMutations);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      document.addEventListener("copy", clipboard.copyCapture, true);
      document.addEventListener("click", onClickCapture, true);
      schedule();
      // 首次渲染可能早于卡片挂载:低频补扫几次,确保扫到
      var retries = 0;
      var retryTimer = setInterval(function () {
        retries++;
        sweepEmptyFences();
        scanDiffs();
        if (retries >= 8) {
          clearInterval(retryTimer);
          retryTimer = null;
        }
      }, 2000);
      // 调试入口:控制台里 window.dshRichCopy.rescan() / .rescanDiff() 可手动触发
      // (旧名保留兼容);setDiffHighlight(false) 可关掉 diff 着色;
      // setFenceGuard(false) 可关掉 genui 空围栏止血
      window.dshRichCopy = {
        rescan: scan,
        rescanDiff: scanDiffs,
        setDiffHighlight: function (on) {
          diffEnabled = !!on;
          if (diffEnabled) scanDiffs();
        },
        setFenceGuard: function (on) {
          fenceGuardEnabled = !!on;
          if (fenceGuardEnabled) sweepEmptyFences();
        },
        diffDebug: function () {
          var blocks = document.querySelectorAll("[data-diff]");
          var out = [];
          for (var i = 0; i < Math.min(blocks.length, 3); i++) {
            var b = blocks[i];
            var body = findDiffBody(b);
            var head = b.querySelector('[class*="_heading_"]');
            out.push({
              heading: head ? (head.textContent || "").trim() : null,
              rows: body ? body.children.length : 0,
              colored: b.querySelectorAll("[data-dsh-colored]").length
            });
          }
          return {
            enabled: diffEnabled,
            fenceGuard: fenceGuardEnabled,
            guardedFences: guardedFenceCount,
            lastError: lastDiffError,
            blocks: out
          };
        }
      };
      window.etsHighlightRichCopy = window.dshRichCopy;
      if (ctx && typeof ctx.on === "function") {
        try {
          ctx.on("dispose", function () {
            observer.disconnect();
            if (retryTimer) clearInterval(retryTimer);
            if (timer) clearTimeout(timer);
            clipboard.dispose();
            document.removeEventListener("copy", clipboard.copyCapture, true);
            document.removeEventListener("click", onClickCapture, true);
            // 撤销 DOM getter 劫持, 清空全部跨事件状态与缓存
            for (var gi = 0; gi < guardedFenceEls.length; gi++) {
              try { delete guardedFenceEls[gi].childElementCount; } catch (e) {}
            }
            guardedFenceEls.length = 0;
            cssVarCache = null;
            cssVarScope = null;
            highlighterPack = null;
            resolvedPack = null;
          });
        } catch (e) {}
      }
    }

    module.exports = { apply: apply };
    return module.exports;
  }
});