// 零依赖回归入口: 用本机 Edge 无头加载 tests/harness.html, 解析 RESULT 并断言.
// 用法: node tests/run.cjs
// 退出码 0 = 全部通过, 1 = 有失败, 2 = harness 无输出.
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
];
const edge = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
if (!edge) {
  console.error("[FAIL] 未找到本机 Edge, 无法运行 harness");
  process.exit(2);
}

const harness = path.resolve(__dirname, "harness.html");
const url = "file:///" + harness.replace(/\\/g, "/");
const run = spawnSync(
  edge,
  ["--headless=new", "--disable-gpu", "--virtual-time-budget=6000", "--dump-dom", url],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 90000 }
);

if (run.error) {
  console.error("[FAIL] Edge 启动失败:", run.error.message);
  process.exit(2);
}
const stdout = run.stdout || "";
const match = /RESULT\s+(\[[\s\S]*?\])\s*<\/div>/.exec(stdout);
if (!match) {
  console.error("[FAIL] harness 未输出 RESULT. stderr:", (run.stderr || "").slice(0, 500));
  process.exit(2);
}

let rows;
try {
  rows = JSON.parse(match[1]);
} catch (e) {
  console.error("[FAIL] RESULT 不是合法 JSON:", e.message);
  process.exit(2);
}

let failed = 0;
for (const r of rows) {
  const tag = r.pass ? "PASS" : "FAIL";
  const line = `[${tag}] ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`;
  console.log(line);
  if (!r.pass) failed++;
}
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
