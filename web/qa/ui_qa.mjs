// Automated UI QA against a running Retinitry server.
//   node qa/ui_qa.mjs [baseUrl]        (default http://127.0.0.1:8765)
// Writes ../logs/ui_qa.json and screenshots to ../logs/ui_qa/*.png. Exit code 1 if any check fails.
//
// Checks per page: page errors, console errors, failed requests, WebGL context creation / loss, live canvas
// count, long tasks, buttons/links blocked by an overlay, placeholder and text contrast, elements overflowing
// the viewport. Scenarios reproduce the reported bugs: Today eye hover + click -> Eye Lab, cycling Eye Lab
// modes, repeated navigation, case page interactions.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import puppeteer from "puppeteer-core";

const GPU = process.argv.includes("--gpu");   // real GPU (hardware WebGL) instead of software rendering
const BASE = process.argv.slice(2).find((a) => a.startsWith("http")) || "http://127.0.0.1:8765";
const OUT = path.resolve("..", "logs", GPU ? "ui_qa_gpu" : "ui_qa");
fs.mkdirSync(OUT, { recursive: true });

function findChrome() {
  const root = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
  const cands = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    ...(fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d, "chrome-win64", "chrome.exe")) : []),
  ];
  return cands.find((p) => fs.existsSync(p));
}

const report = { base: BASE, started: new Date().toISOString(), pages: [], scenarios: [], failures: [] };
const fail = (where, what, detail) => {
  report.failures.push({ where, what, detail });
  console.log(`  FAIL [${where}] ${what}${detail ? ": " + (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300) : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: GPU
    ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-features=Vulkan", "--window-size=1600,1000", "--no-first-run"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,1000", "--no-first-run"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const ev = { errors: [], console: [], failed: [] };
page.on("pageerror", (e) => ev.errors.push(String(e && e.stack ? e.stack : e)));
page.on("console", (m) => { if (m.type() === "error") ev.console.push(m.text()); });
page.on("requestfailed", (r) => { if (!r.url().includes("/events")) ev.failed.push(`${r.url()} ${r.failure()?.errorText}`); });
await page.evaluateOnNewDocument(() => {
  window.__qa = { contexts: 0, lost: 0, longTasks: 0, longMs: 0 };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const ctx = orig.call(this, type, ...a);
    if (ctx && /webgl/.test(type) && !this.__qaCounted) {
      this.__qaCounted = true; window.__qa.contexts++;
      this.addEventListener("webglcontextlost", () => {
        // R3F calls forceContextLoss() when a canvas unmounts; only a loss on a canvas still in the page is a crash.
        setTimeout(() => { if (this.isConnected) window.__qa.lost++; else window.__qa.disposed = (window.__qa.disposed || 0) + 1; }, 50);
      });
    }
    return ctx;
  };
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__qa.longTasks++; window.__qa.longMs += e.duration; }))
      .observe({ entryTypes: ["longtask"] });
  } catch {}
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function takeEvents() { const e = { errors: ev.errors.splice(0), console: ev.console.splice(0), failed: ev.failed.splice(0) }; return e; }

// ---------------------------------------------------------------- in-page audits
async function audit(name) {
  return page.evaluate((name) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05 &&
        r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
    const desc = (el) => { if (!el) return "null"; let s = el.tagName.toLowerCase(); if (el.id) s += "#" + el.id;
      const c = (el.className && typeof el.className === "string") ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
      if (c) s += "." + c; const t = (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30); return t ? `${s} "${t}"` : s; };
    const blocked = [], noCursor = [];
    const clickables = [...document.querySelectorAll("a[href],button,[role=button],input,select,textarea,[role=tab]")].filter(vis);
    for (const el of clickables) {
      if (el.disabled) continue;
      const r = el.getBoundingClientRect();
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(x, y);
      let blockedNow = top && top !== el && !el.contains(top) && !top.contains(el);
      // QA false-positive fix: page content that merely scrolls underneath the floating tab bar is reachable by
      // scrolling. Only count it if it is still covered after scrolling it to the middle of the viewport.
      if (blockedNow && top.closest("nav") && !el.closest("nav")) {
        const sx0 = scrollX, sy0 = scrollY;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const r2 = el.getBoundingClientRect();
        const t2 = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r2.left + r2.width / 2)), Math.min(innerHeight - 1, Math.max(0, r2.top + r2.height / 2)));
        blockedNow = t2 && t2 !== el && !el.contains(t2) && !t2.contains(el);
        window.scrollTo(sx0, sy0);
      }
      if (blockedNow) blocked.push({ el: desc(el), by: desc(top) });
      const cur = getComputedStyle(el).cursor;
      if (["A", "BUTTON"].includes(el.tagName) && cur !== "pointer") noCursor.push(desc(el));
    }
    // contrast
    const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return { L: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m[3] === undefined ? 1 : +m[3] }; };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; const l = lum(b); if (l && l.a > 0.5) return l.L; } return 0; };
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const lowContrast = [];
    for (const el of [...document.querySelectorAll("input[placeholder],textarea[placeholder]")].filter(vis)) {
      const s = getComputedStyle(el, "::placeholder"); const f = lum(s.color); if (!f) continue;
      const fg = f.L * f.a + bgOf(el) * (1 - f.a); const cr = ratio(fg, bgOf(el));
      if (cr < 3) lowContrast.push({ el: desc(el), placeholder: el.placeholder, ratio: +cr.toFixed(2) });
    }
    const missingPlaceholder = [...document.querySelectorAll("input[type=text],input:not([type]),input[type=number],textarea")]
      .filter(vis).filter((el) => !el.placeholder && !el.value).map(desc);
    let lowText = 0; const lowTextEx = [];
    for (const el of [...document.querySelectorAll("p,span,div,h1,h2,h3,label,a,button,li,td,th")].filter(vis)) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)) continue;
      const s = getComputedStyle(el); const f = lum(s.color); if (!f) continue;
      if (f.L < 0.05 && el.closest("[aria-pressed=true],[aria-selected=true],[data-active=true]")) continue;
      const bg = bgOf(el); const fg = f.L * f.a * (+s.opacity) + bg * (1 - f.a * (+s.opacity)); const cr = ratio(fg, bg);
      const big = parseFloat(s.fontSize) >= 18; if (cr < (big ? 3 : 3.2)) { lowText++; if (lowTextEx.length < 6) lowTextEx.push({ el: desc(el), ratio: +cr.toFixed(2) }); }
    }
    const overflowX = document.documentElement.scrollWidth > innerWidth + 2;
    const inScroller = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const ox = getComputedStyle(e).overflowX; if ((ox === "auto" || ox === "scroll") && e.scrollWidth > e.clientWidth) return e; } return null; };
    const offscreen = [...document.querySelectorAll("button,a[href]")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 2 || r.left < -2); })
      .filter((el) => { const sc = inScroller(el); return !sc || !sc.closest("[data-scroll-hint]"); }).map(desc).slice(0, 5);
    const canvases = document.querySelectorAll("canvas").length;
    // full-screen layers that eat clicks (the "suddenly unclickable" bug)
    const coverers = [...document.querySelectorAll("body *")].filter((el) => {
      const s = getComputedStyle(el); if (s.pointerEvents === "none" || !vis(el)) return false;
      if (!["fixed", "absolute"].includes(s.position)) return false;
      const r = el.getBoundingClientRect(); if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) return false;
      const bg = s.backgroundColor; const transparent = bg === "rgba(0, 0, 0, 0)" || bg === "transparent";
      return transparent && +s.opacity < 0.05;
    }).map(desc).slice(0, 5);
    // text clipped by its own box (misalignment / cut-off labels)
    const clipped = [...document.querySelectorAll("button,label,h1,h2,h3,p,span")].filter(vis).filter((el) => {
      const s = getComputedStyle(el); return (s.overflow === "hidden" || s.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0;
    }).map(desc).slice(0, 8);
    return { name, clickables: clickables.length, blocked, noCursor, lowContrast, missingPlaceholder, lowText, lowTextEx, overflowX, offscreen, canvases, coverers, clipped, qa: { ...window.__qa }, title: document.title, nothingHere: document.body.innerText.includes("Nothing here.") };
  }, name);
}

async function visit(name, url, { wait = 3500, shot = true } = {}) {
  const t0 = Date.now();
  try { await page.goto(BASE + url, { waitUntil: "networkidle2", timeout: 45000 }); } catch (e) { fail(name, "navigation", String(e)); }
  await sleep(wait);
  const a = await audit(name);
  a.fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(Math.round(n / ((performance.now() - t0) / 1000))); }; requestAnimationFrame(f); }));
  a.renderer = await page.evaluate(() => { try { const c = document.createElement("canvas"); const gl = c.getContext("webgl2"); const e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown"; } catch { return "none"; } });
  a.loadMs = Date.now() - t0;
  const e = takeEvents();
  Object.assign(a, e);
  if (shot) await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  report.pages.push(a);
  if (GPU && a.canvases > 0 && a.fps < 45) fail(name, "frame rate below 45 fps on real GPU", `${a.fps} fps`);
  console.log(`- ${name} (${a.loadMs} ms, ${a.fps} fps): ${a.clickables} clickables, ${a.canvases} canvas, contexts ${a.qa.contexts}, lost ${a.qa.lost}, long tasks ${a.qa.longTasks} (${Math.round(a.qa.longMs)} ms)`);
  if (a.nothingHere) fail(name, "route shows NotFound");
  e.errors.forEach((x) => fail(name, "page error", x));
  e.console.forEach((x) => fail(name, "console error", x));
  e.failed.forEach((x) => fail(name, "request failed", x));
  if (a.qa.lost) fail(name, "WebGL context lost", a.qa.lost);
  a.blocked.forEach((b) => fail(name, "click blocked", b));
  a.lowContrast.forEach((b) => fail(name, "placeholder contrast", b));
  a.missingPlaceholder.forEach((b) => fail(name, "input without placeholder", b));
  if (a.lowText) fail(name, "low-contrast text", { count: a.lowText, examples: a.lowTextEx });
  if (a.overflowX) fail(name, "horizontal overflow");
  a.offscreen.forEach((b) => fail(name, "control off-screen", b));
  a.coverers.forEach((b) => fail(name, "invisible full-screen layer catches clicks", b));
  a.clipped.forEach((b) => fail(name, "text clipped", b));
  if (a.canvases > 1) fail(name, "more than one live WebGL canvas", a.canvases);
  if (a.qa.longMs > 2500) fail(name, "main thread blocked (lag)", `${Math.round(a.qa.longMs)} ms of long tasks`);
  a.noCursor.slice(0, 5).forEach((b) => fail(name, "clickable without pointer cursor", b));
  return a;
}

async function scenario(name, fn) {
  console.log(`* scenario: ${name}`);
  const s = { name, ok: true, notes: [] };
  try { await fn(s); } catch (e) { s.ok = false; fail(name, "scenario threw", String(e)); }
  const e = takeEvents();
  e.errors.forEach((x) => { s.ok = false; fail(name, "page error", x); });
  e.console.forEach((x) => { s.ok = false; fail(name, "console error", x); });
  const qa = await page.evaluate(() => ({ ...window.__qa, canvases: document.querySelectorAll("canvas").length, nothing: document.body.innerText.includes("Nothing here.") || document.body.innerText.trim().length < 20 }));
  s.qa = qa;
  if (qa.lost) { s.ok = false; fail(name, "WebGL context lost", qa.lost); }
  if (qa.nothing) { s.ok = false; fail(name, "page blank or NotFound after scenario"); }
  await page.screenshot({ path: path.join(OUT, `scenario-${name}.png`) });
  report.scenarios.push(s);
}

const clickText = async (txt, sel = "button,a,[role=tab],[role=button]") => {
  const ok = await page.evaluate((txt, sel) => {
    const label = (e) => [e.getAttribute("aria-label") || "", ...(e.innerText || "").split("\n")].map((x) => x.trim().toLowerCase()).filter(Boolean);
    const el = [...document.querySelectorAll(sel)].find((e) => label(e).some((l) => l === txt.toLowerCase() || l.startsWith(txt.toLowerCase())));
    if (!el) return false; el.scrollIntoView({ block: "center" }); el.click(); return true;
  }, txt, sel);
  if (!ok) throw new Error(`no clickable "${txt}"`);
};

// ---------------------------------------------------------------- data
const encs = await (await fetch(BASE + "/api/encounters?limit=50")).json();
const encId = (encs.find((e) => e.patient_code === "DEMO-refer-soon") || encs[0] || {}).id;

// ---------------------------------------------------------------- pages
for (const [n, u] of [["today", "/"], ["new", "/screen/new"], ["queue", "/queue"], ["referrals", "/referrals"],
  ["evidence", "/evidence"], ["lab", "/lab"], ["settings", "/settings"], ["audit", "/audit"]]) await visit(n, u);
if (encId) await visit("case", `/case/${encId}`, { wait: 6000 });

// ---------------------------------------------------------------- scenarios (reported bugs)
await scenario("today-eye-hover-click", async (s) => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" }); await sleep(3000);
  const box = await page.evaluate(() => { const c = document.querySelector("canvas"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (!box) { s.ok = false; fail(s.name, "no eye canvas on Today"); return; }
  const before = await page.screenshot({ encoding: "base64", clip: { x: box.x - 150, y: box.y - 150, width: 300, height: 300 } });
  await page.mouse.move(box.x + 40, box.y - 30, { steps: 8 }); await sleep(900);
  const after = await page.screenshot({ encoding: "base64", clip: { x: box.x - 150, y: box.y - 150, width: 300, height: 300 } });
  const cursor = await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)).cursor, box);
  s.notes.push({ hoverChangesPixels: before !== after, cursor });
  if (before === after) fail(s.name, "hovering the eye changes nothing visible");
  if (cursor !== "pointer") fail(s.name, "eye has no pointer cursor", cursor);
  await page.mouse.click(box.x, box.y); await sleep(4000);
  s.notes.push({ url: page.url() });
  if (!page.url().includes("/lab")) fail(s.name, "clicking the eye did not open Eye Lab", page.url());
});

await scenario("lab-modes-cycle", async () => {
  await page.goto(BASE + "/lab", { waitUntil: "networkidle2" }); await sleep(2500);
  for (let k = 0; k < 4; k++) for (const m of ["Optics", "DR Stages", "Coverage", "Anatomy"]) { await clickText(m); await sleep(1200); }
  // drag sliders / orbit
  const c = await page.$("canvas"); if (c) { const b = await c.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 200, b.y + b.height / 2 + 40, { steps: 15 }); await page.mouse.up(); await page.mouse.wheel({ deltaY: -400 }); }
  await sleep(1500);
});

await scenario("navigate-loop", async (s) => {
  for (let k = 0; k < 6; k++) for (const u of ["/", "/lab", encId ? `/case/${encId}` : "/queue", "/evidence"]) { await page.goto(BASE + u, { waitUntil: "domcontentloaded" }); await sleep(1500); }
  await page.goto(BASE + "/lab", { waitUntil: "networkidle2" }); await sleep(2500);
});

// in-app (client-side) navigation: the real user path; contexts must not pile up
await scenario("spa-navigation-leak", async (s) => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" }); await sleep(2500);
  for (let k = 0; k < 5; k++) for (const t of ["Eye Lab", "Evidence", "Queue", "Today"]) {
    await clickText(t, "nav button, nav a, [role=tab], nav [role=button]"); await sleep(1500);
  }
  const live = await page.evaluate(() => document.querySelectorAll("canvas").length);
  s.notes.push({ liveCanvases: live });
  if (live > 1) { s.ok = false; fail(s.name, "canvases left mounted after navigation", live); }
  // after all that, the tab bar and main buttons must still be clickable
  const a = await audit("after-spa-navigation");
  a.blocked.forEach((b) => { s.ok = false; fail(s.name, "click blocked after navigation", b); });
  a.coverers.forEach((b) => { s.ok = false; fail(s.name, "invisible layer after navigation", b); });
});

// a real context loss must not kill the app: the page should recover (or offer a restore button)
await scenario("context-loss-recovery", async (s) => {
  await page.goto(BASE + "/lab", { waitUntil: "networkidle2" }); await sleep(2500);
  await page.evaluate(() => { const c = document.querySelector("canvas"); const gl = c && (c.getContext("webgl2") || c.getContext("webgl")); const ext = gl && gl.getExtension("WEBGL_lose_context"); if (ext) { ext.loseContext(); window.__qaExt = ext; } });
  await sleep(1500);
  const st = await page.evaluate(() => ({ text: document.body.innerText, canvases: document.querySelectorAll("canvas").length }));
  const recovered = /restore|reload 3d|3d paused/i.test(st.text) || st.canvases >= 1;
  s.notes.push({ recoveredUi: recovered });
  if (!/restore|3d paused/i.test(st.text)) fail(s.name, "no visible message or restore button after GPU context loss");
  await page.evaluate(() => window.__qa.lost = 0); // this loss was induced on purpose
  try { await clickText("Restore"); await sleep(2500); } catch {}
  const ok = await page.evaluate(() => document.querySelectorAll("canvas").length);
  if (!ok) fail(s.name, "3D did not come back after restore");
});

// every route must render inside an error boundary (a crash shows a message, not a black screen)
await scenario("error-boundary", async (s) => {
  await page.goto(BASE + "/lab?qa_crash=1", { waitUntil: "networkidle2" }); await sleep(2000);
  const txt = await page.evaluate(() => document.body.innerText);
  takeEvents(); // the induced error is expected
  if (!/something went wrong|try again/i.test(txt)) fail(s.name, "a render crash leaves the app blank (no error boundary)");
  const nav = await page.evaluate(() => !!document.querySelector("nav"));
  if (!nav) fail(s.name, "tab bar disappears when a page crashes");
  const logged = await (await fetch(BASE + "/api/client-log?limit=5")).json();
  if (!logged.items?.some((x) => /qa_crash|QA induced/i.test(JSON.stringify(x)))) fail(s.name, "crash was not written to logs/client.log");
});

await scenario("tabbar-clicks", async (s) => {
  await page.goto(BASE + "/", { waitUntil: "networkidle2" }); await sleep(2000);
  for (let k = 0; k < 3; k++) for (const t of ["Queue", "Referrals", "Evidence", "Eye Lab", "Today"]) {
    await clickText(t, "nav button, nav a, [role=tab]"); await sleep(1300);
    const blocked = await page.evaluate(() => { const r = document.querySelector("nav")?.getBoundingClientRect(); if (!r) return "no nav"; const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return document.querySelector("nav").contains(el) ? null : (el?.tagName + "." + el?.className); });
    if (blocked) { s.ok = false; fail(s.name, `tab bar blocked after "${t}"`, blocked); }
  }
});

if (encId) await scenario("case-interactions", async () => {
  await page.goto(BASE + `/case/${encId}`, { waitUntil: "networkidle2" }); await sleep(4000);
  for (const t of ["Attention · CNN", "Attention · ViT", "Lesions", "Landmarks", "Macula ring", "Unimaged", "Split", "Outside", "Cross-section", "Layers", "Reset", "OS", "OD", "Why this outcome"]) { try { await clickText(t); } catch {} await sleep(700); }
  await sleep(1500);
});

report.finished = new Date().toISOString();
report.gpu = GPU; report.renderer = report.pages[0]?.renderer;
fs.writeFileSync(path.resolve("..", "logs", GPU ? "ui_qa_gpu.json" : "ui_qa.json"), JSON.stringify(report, null, 2));
console.log("renderer:", report.renderer);
await browser.close();
console.log(`\n${report.failures.length} failures. Report: logs/ui_qa.json, screenshots: logs/ui_qa/`);
process.exit(report.failures.length ? 1 : 0);
