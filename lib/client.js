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
      timer = setTimeout(function () { timer = null; scan(); scanDiffs(); }, 300);
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
    var shikiFailures = 0;

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
    function colorizeDiffRows(rows, lang, pack, force) {
      var segments = [];
      var current = null;
      var lastKey = null;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var kind = rowKind(row, i === 0);
        if (kind === "path" || kind === "gap") { current = null; lastKey = null; continue; }
        if (!force && row.getAttribute("data-dsh-colored") === "1") continue;
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

    async function upgradeDiffWithShiki() {
      if (shikiUpgradeStarted || shikiUpgraded || builtinMode || !diffEnabled) return;
      shikiUpgradeStarted = true;
      var pack;
      try {
        pack = await withTimeout(getHighlighter(), 12000);
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
          var heading = block.querySelector('[class*="_heading_"]');
          var lang = langFromHeading(heading ? heading.textContent : "");
          if (!lang) {
            var pathText = (rows[0].textContent || "").trim().split(/[:(]/)[0];
            lang = langForPath(pathText);
          }
          if (!lang) continue;
          if (!(await ensureDiffLang(pack, lang))) continue;
          colorizeDiffRows(rows, lang, pack, true);
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

    // diff 的纯文本复制保持宿主格式:删除行 `- `、新增行 `+ `、路径与 gap 原样。
    function diffCopyText(block) {
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

    function wrapDiffHtml(block, fragment) {
      // 展开/收起按钮不进剪贴板
      var buttons = fragment.querySelectorAll ? fragment.querySelectorAll("button") : [];
      for (var b = buttons.length - 1; b >= 0; b--) {
        if (buttons[b].parentNode) buttons[b].parentNode.removeChild(buttons[b]);
      }
      var tmp = document.createElement("div");
      tmp.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;";
      tmp.appendChild(fragment);
      // 挂到卡片旁边而不是 body:组件级 CSS 变量与行样式仍然可用
      var anchor = block.parentElement || document.body;
      anchor.appendChild(tmp);
      // 行底色来自计算样式,克隆后必须显式写回,否则离开 DSH 就丢
      var lines = tmp.querySelectorAll("div");
      for (var i = 0; i < lines.length; i++) {
        var lineEl = lines[i];
        var tint = bgTint(lineEl);
        var hasTint = tint && tint !== "rgba(0, 0, 0, 0)" && tint !== "transparent";
        if (!hasTint) {
          // 计算样式取不到(片段离开样式表)时按行类型兜底红绿底色
          var kind = rowKind(lineEl, i === 0);
          if (kind === "add") tint = "rgba(46, 160, 67, 0.15)";
          else if (kind === "del") tint = "rgba(248, 81, 73, 0.15)";
          else tint = "";
        }
        if (tint) lineEl.style.backgroundColor = tint;
      }
      resolveVarStyles(tmp, block);
      var inner = tmp.innerHTML;
      anchor.removeChild(tmp);

      var body = findDiffBody(block);
      var cs = body ? getComputedStyle(body) : null;
      var wrap = document.createElement("div");
      wrap.style.background = solidBg(block);
      wrap.style.color = (cs ? cs.color : "") || "#000";
      wrap.style.fontFamily = (cs ? cs.fontFamily : "") || "monospace";
      wrap.style.fontSize = (cs ? cs.fontSize : "") || "12px";
      wrap.style.lineHeight = (cs ? cs.lineHeight : "") || "1.6";
      wrap.style.padding = "8px 12px";
      wrap.style.borderRadius = "6px";
      wrap.style.whiteSpace = "pre";
      wrap.style.overflowX = "auto";
      wrap.innerHTML = inner;
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

    function selectDiffAndCopy(body) {
      var sel = window.getSelection();
      var saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      var range = document.createRange();
      range.selectNodeContents(body);
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand("copy"); } catch (e) {}
      sel.removeAllRanges();
      if (saved) try { sel.addRange(saved); } catch (e) {}
    }

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

    function resolveVarStyles(root, scopeEl) {
      // 只挑 inline style 里真的带变量引用的节点,避免对每个 token 都算样式
      var targets = root.querySelectorAll('[style*="var("], [style*="light-dark("]');
      for (var i = 0; i < targets.length; i++) {
        var el = targets[i];
        var style = el.style;
        if (!style) continue;
        try {
          if (style.color && style.color.indexOf("var(") !== -1) {
            style.color = resolveColorValue(style.color, scopeEl) || getComputedStyle(el).color;
          } else if (style.color && style.color.indexOf("light-dark(") !== -1) {
            style.color = getComputedStyle(el).color;
          }
          if (style.backgroundColor && style.backgroundColor.indexOf("var(") !== -1) {
            style.backgroundColor = getComputedStyle(el).backgroundColor;
          }
        } catch (e) {}
      }
    }

    function wrapCodeHtml(blockEl, fragment) {
      // 临时挂载到真实 DOM 以解析 CSS 变量
      var tmp = document.createElement("div");
      tmp.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;";
      tmp.appendChild(fragment);
      // 挂到代码块同级而不是 body:减少整页样式重算,变量作用域也正确
      var anchor = (blockEl && blockEl.parentElement) || document.body;
      anchor.appendChild(tmp);
      resolveVarStyles(tmp, blockEl);
      var innerHtml = tmp.innerHTML;
      anchor.removeChild(tmp);

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

    function codeContainerOf(node) {
      if (!node || !node.closest) return null;
      var diff = node.closest("[data-diff]");
      if (diff) return { kind: "diff", el: diff };
      var code = node.closest(".md-code-block");
      if (code) return { kind: "code", el: code };
      return null;
    }

    function onCopyCapture(e) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      var node = sel.anchorNode;
      node = node && (node.nodeType === 1 ? node : node.parentElement);
      var target = codeContainerOf(node);
      if (!target) return;
      var frag = sel.getRangeAt(0).cloneContents();
      if (target.kind === "diff") {
        var body = findDiffBody(target.el);
        var whole = body ? selectionCoversBody(sel, body) : false;
        e.clipboardData.setData("text/html", wrapDiffHtml(target.el, frag));
        e.clipboardData.setData("text/plain", whole ? diffCopyText(target.el) : sel.toString());
      } else {
        e.clipboardData.setData("text/html", wrapCodeHtml(target.el, frag));
        e.clipboardData.setData("text/plain", sel.toString());
      }
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
      if (!e.target || !e.target.closest) return;
      var codeBtn = e.target.closest("[data-code-block-banner] button");
      // diff 卡的头部同样带 data-code-block-banner,必须排除,交给下面的 diff 分支
      if (codeBtn && !codeBtn.closest("[data-diff]")) {
        // 只接管复制按钮(横幅里可能还有其他按钮)
        var label = (codeBtn.getAttribute("aria-label") || codeBtn.textContent || "").trim();
        if (label && !/复制|copy/i.test(label)) return;
        var blockEl = codeBtn.closest(".md-code-block");
        var code = blockEl ? blockEl.querySelector("pre code") : null;
        if (!code) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        selectAndCopy(code);
        return;
      }
      var diffBtn = e.target.closest("[data-diff] button");
      if (!diffBtn) return;
      // diff 卡右上角按钮组里的复制键可能是图标按钮(无文案):
      // 用 aria-expanded 排除展开键,其余带"复制/copy"文案的接管;
      // 完全无文案的图标按钮也按复制处理。
      if (diffBtn.hasAttribute("aria-expanded")) return;
      var text = (diffBtn.getAttribute("aria-label") || diffBtn.getAttribute("title") || diffBtn.textContent || "").trim();
      if (text && !/复制|复制成功|copy/i.test(text)) return;
      var diffBlock = diffBtn.closest("[data-diff]");
      var diffBody = diffBlock ? findDiffBody(diffBlock) : null;
      if (!diffBody) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      selectDiffAndCopy(diffBody);
    }

    function apply(ctx) {
      if (typeof document === "undefined" || !document.body) return;
      var observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      document.addEventListener("copy", onCopyCapture, true);
      document.addEventListener("click", onClickCapture, true);
      schedule();
      // 首次渲染可能早于卡片挂载:低频补扫几次,确保扫到
      var retries = 0;
      var retryTimer = setInterval(function () {
        retries++;
        scanDiffs();
        if (retries >= 8) {
          clearInterval(retryTimer);
          retryTimer = null;
        }
      }, 2000);
      // 调试入口:控制台里 window.dshRichCopy.rescan() / .rescanDiff() 可手动触发
      // (旧名保留兼容);setDiffHighlight(false) 可关掉 diff 着色
      window.dshRichCopy = {
        rescan: scan,
        rescanDiff: scanDiffs,
        setDiffHighlight: function (on) {
          diffEnabled = !!on;
          if (diffEnabled) scanDiffs();
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
              skip: b.getAttribute("data-dsh-diff-skip"),
              rows: body ? body.children.length : 0,
              colored: b.querySelectorAll("[data-dsh-colored]").length
            });
          }
          return { enabled: diffEnabled, lastError: lastDiffError, blocks: out };
        }
      };
      window.etsHighlightRichCopy = window.dshRichCopy;
      if (ctx && typeof ctx.on === "function") {
        try {
          ctx.on("dispose", function () {
            observer.disconnect();
            if (retryTimer) clearInterval(retryTimer);
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