// Probe: does the Eye Lab canvas actually draw on the real GPU? Reads pixels from the live WebGL context.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import puppeteer from "puppeteer-core";
const root = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", ...(fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d, "chrome-win64", "chrome.exe")) : [])].find((p) => fs.existsSync(p));
const GPU = process.argv.includes("--gpu");
const browser = await puppeteer.launch({ executablePath: chrome, headless: !process.argv.includes("--headful"), defaultViewport: { width: 1600, height: 1000 },
  args: GPU ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-features=Vulkan", "--window-size=1600,1000"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
if (process.argv.includes("--preserve")) await page.evaluateOnNewDocument(() => {
  const o = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) { return o.call(this, t, /webgl/.test(t) ? { ...(a || {}), preserveDrawingBuffer: true } : a); };
});
page.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 300)));
const route = process.argv.slice(2).find((a) => a.startsWith("/")) || "/lab";
await page.goto("http://127.0.0.1:8765" + route, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 4000));
const res = await page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => {
    const c = document.querySelector("canvas");
    if (!c) return resolve("no canvas");
    const gl = c.getContext("webgl2");
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4 * 9);
    const out = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.6, 0.5], [0.4, 0.4]]) { const p = new Uint8Array(4); gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); out.push([...p].join(",")); }
    resolve({ w, h, out, measures: performance.getEntriesByType("measure").map((m) => `${m.name} ${Math.round(m.startTime)}+${Math.round(m.duration)}`) });
  });
}));
console.log(JSON.stringify(res));
console.log(await page.evaluate(() => {
  const c = document.querySelector("canvas"); if (!c) return "none";
  const chain = []; for (let e = c; e; e = e.parentElement) { const s = getComputedStyle(e); chain.push(`${e.tagName}.${(e.className || "").toString().slice(0, 40)} op=${s.opacity} vis=${s.visibility} f=${s.filter} t=${s.transform.slice(0, 30)} z=${s.zIndex}`); }
  const r = c.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width * 0.6, r.top + r.height / 2);
  return { rect: [r.left, r.top, r.width, r.height], top: top?.tagName + "." + top?.className, chain };
}));
await page.screenshot({ path: path.resolve("..", "logs", "profile", "probe.png"), captureBeyondViewport: false });
await browser.close();
