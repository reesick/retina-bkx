// Opens Eye Lab (and Today / a case) in a VISIBLE Chrome window on the real GPU and screenshots each Lab mode,
// with post-processing on and off. Usage: node qa/lab_visible.mjs [baseUrl]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] || "http://127.0.0.1:8765";
const OUT = path.resolve("..", "logs", "lab_visible");
fs.mkdirSync(OUT, { recursive: true });
const root = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  ...(fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d, "chrome-win64", "chrome.exe")) : [])].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: false, args: ["--window-size=1600,1000", "--ignore-gpu-blocklist"], defaultViewport: null });
const page = (await browser.pages())[0];
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fraction of non-black pixels inside the canvas, read from a real screenshot (compositor output)
async function litShare(name) {
  const box = await page.evaluate(() => { const c = document.querySelector("canvas"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  if (!box) return { name, canvas: false };
  const lit = await page.evaluate(async (src, box) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(Math.round(box.x), Math.round(box.y), Math.max(1, Math.round(box.w)), Math.max(1, Math.round(box.h))).data;
    let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 60) n++;
    return n / (d.length / 16);
  }, "data:image/png;base64," + fs.readFileSync(file).toString("base64"), box);
  return { name, canvas: true, lit: +lit.toFixed(3) };
}

const results = [];
for (const q of ["", "?lowpower=1"]) {
  await page.goto(`${BASE}/lab${q}`, { waitUntil: "networkidle2" }); await sleep(4000);
  for (const mode of ["Anatomy", "Optics", "DR Stages", "Coverage"]) {
    await page.evaluate((m) => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === m); b?.click(); }, mode);
    await sleep(3500);
    results.push(await litShare(`lab-${mode.replace(/\s/g, "")}${q ? "-lowpower" : "-effects"}`));
  }
}
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" }); await sleep(4000);
results.push(await litShare("today"));
const renderer = await page.evaluate(() => { const gl = document.createElement("canvas").getContext("webgl2"); const e = gl.getExtension("WEBGL_debug_renderer_info"); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL); });
console.log("renderer:", renderer);
for (const r of results) console.log(r.canvas ? `${r.name}: ${(r.lit * 100).toFixed(1)}% lit pixels` : `${r.name}: no canvas`);
console.log("errors:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
