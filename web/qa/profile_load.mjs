// Profile main-thread long tasks during page load (same Chrome flags as ui_qa.mjs).
//   node qa/profile_load.mjs [--gpu] [--trace] [path ...]
// Prints long tasks and, with --trace, the top self-time functions inside long tasks from a DevTools trace.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import puppeteer from "puppeteer-core";

const GPU = process.argv.includes("--gpu");
const TRACE = process.argv.includes("--trace");
const BASE = "http://127.0.0.1:8765";
const routes = process.argv.slice(2).filter((a) => a.startsWith("/"));
if (!routes.length) routes.push("/", "/lab");
const OUT = path.resolve("..", "logs", "profile");
fs.mkdirSync(OUT, { recursive: true });

const root = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", ...(fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d, "chrome-win64", "chrome.exe")) : [])].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({
  executablePath: chrome, headless: true,
  args: GPU
    ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-features=Vulkan", "--window-size=1600,1000", "--no-first-run"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,1000", "--no-first-run"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  window.__lt = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ["longtask"] });
  // time every WebGL call; slow ones are kept with a short stack
  window.__gl = {};
  window.__glSlow = [];
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue;
    for (const k of Object.getOwnPropertyNames(C.prototype)) {
      const d = Object.getOwnPropertyDescriptor(C.prototype, k);
      if (!d || typeof d.value !== "function") continue;
      const f = d.value;
      C.prototype[k] = function (...a) {
        const t = performance.now();
        const r = f.apply(this, a);
        const dt = performance.now() - t;
        if (dt > 0.5) {
          const s = (window.__gl[k] ||= [0, 0]); s[0] += dt; s[1]++;
          if (dt > 15) window.__glSlow.push([k, Math.round(t), Math.round(dt), (new Error().stack || "").split("\n").slice(2, 14).map((x) => x.trim().replace(/https?:\/\/[^/]+\/assets\//, "")).join(" < ")]);
        }
        return r;
      };
    }
  }
});
for (const r of routes) {
  const name = r === "/" ? "today" : r.replace(/\W+/g, "_");
  if (TRACE) await page.tracing.start({ path: path.join(OUT, `${name}${GPU ? "_gpu" : ""}.json`), categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-v8.cpu_profiler", "v8.execute", "blink.user_timing"] });
  await page.goto(BASE + r, { waitUntil: "networkidle2" });
  await new Promise((res) => setTimeout(res, 3500));
  if (TRACE) await page.tracing.stop();
  await page.screenshot({ path: path.join(OUT, `${name}${GPU ? "_gpu" : ""}.png`) });
  const lt = await page.evaluate(() => window.__lt);
  const marks = await page.evaluate(() => performance.getEntriesByType("measure").map((m) => `${m.name} ${Math.round(m.startTime)}+${Math.round(m.duration)}`));
  console.log(`${r}: ${lt.length} long tasks, ${lt.reduce((a, b) => a + b[1], 0)} ms`, JSON.stringify(lt));
  if (marks.length) console.log("  measures:", marks.join(" | "));
  const gl = await page.evaluate(() => ({ tot: Object.entries(window.__gl).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8).map(([k, v]) => `${k} ${Math.round(v[0])}ms/${v[1]}`), slow: window.__glSlow.slice(0, 40) }));
  console.log("  gl time:", gl.tot.join(" | "));
  for (const s of gl.slow) console.log("   slow", s.join("  "));
  if (TRACE) summarise(path.join(OUT, `${name}${GPU ? "_gpu" : ""}.json`));
  await page.goto("about:blank");
}
await browser.close();

function summarise(file) {
  const t = JSON.parse(fs.readFileSync(file, "utf8"));
  const ev = t.traceEvents ?? t;
  // main renderer thread = thread with most RunTask
  const main = {};
  for (const e of ev) if (e.name === "CrRendererMain" && e.ph === "M") main[`${e.pid}:${e.tid}`] = 1;
  const isMain = (e) => main[`${e.pid}:${e.tid}`];
  const tasks = ev.filter((e) => isMain(e) && e.name === "RunTask" && e.dur > 50000);
  // aggregate top-level child events within long tasks
  const agg = {};
  for (const e of ev) {
    if (!isMain(e) || !e.dur) continue;
    const inLong = tasks.some((t) => e.ts >= t.ts && e.ts < t.ts + t.dur);
    if (!inLong) continue;
    let k = e.name;
    if (e.name === "FunctionCall" || e.name === "EvaluateScript" || e.name === "v8.compile" || e.name === "v8.parseOnBackground") {
      const d = e.args?.data ?? {};
      k = `${e.name} ${(d.url || "").split("/").pop()}:${d.functionName || ""}`;
    }
    agg[k] = (agg[k] || 0) + e.dur / 1000;
  }
  const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log("  long RunTasks:", tasks.map((t) => Math.round(t.dur / 1000)).join(", "));
  for (const [k, v] of top) console.log(`   ${v.toFixed(0).padStart(6)} ms  ${k}`);
  // CPU profile samples: self time by function in long tasks
  const prof = ev.filter((e) => e.name === "ProfileChunk");
  const nodes = new Map();
  const self = {};
  let lastTs = null;
  for (const c of prof) {
    const cp = c.args?.data?.cpuProfile;
    if (!cp) continue;
    for (const n of cp.nodes ?? []) nodes.set(n.id, n);
    const deltas = c.args.data.timeDeltas ?? [];
    let ts = lastTs ?? 0;
    (cp.samples ?? []).forEach((s, i) => {
      ts += deltas[i] ?? 0;
      const n = nodes.get(s);
      if (!n) return;
      const cf = n.callFrame;
      const k = `${cf.functionName || "(anon)"} ${(cf.url || "").split("/").pop()}:${cf.lineNumber}`;
      self[k] = (self[k] || 0) + (deltas[i] ?? 0) / 1000;
    });
    lastTs = ts;
  }
  const topS = Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (topS.length) {
    console.log("  top self-time (all samples):");
    for (const [k, v] of topS) console.log(`   ${v.toFixed(0).padStart(6)} ms  ${k}`);
  }
}
