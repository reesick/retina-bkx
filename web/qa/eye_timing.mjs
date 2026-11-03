// Visible Chrome on the real GPU: how long until the 3D eye actually shows on Today and Eye Lab, for each switch.
// Samples the centre region of the canvas from real screenshots every 500 ms for up to 15 s.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.argv.slice(2).find((a) => a.startsWith("http")) || "http://127.0.0.1:8765";
const root = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
const exe = ["C:/Program Files/Google/Chrome/Application/chrome.exe",
  ...(fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d, "chrome-win64", "chrome.exe")) : [])].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: false, args: ["--window-size=1600,1000", "--ignore-gpu-blocklist"], defaultViewport: null });
const page = (await browser.pages())[0];
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (["error", "warn"].includes(m.type())) errs.push(m.text().slice(0, 200)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function centreLit() {
  const box = await page.evaluate(() => { const c = document.querySelector("canvas"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.3, w: r.width * 0.4, h: r.height * 0.4 }; });
  if (!box || box.w < 10) return -1;
  const b64 = await page.screenshot({ encoding: "base64", clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  return page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 90) n++;
    return n / (d.length / 16);
  }, "data:image/png;base64," + b64);
}

const only = process.argv.includes("--lab"); const list = only ? [["lab?lowpower=1", "/lab?lowpower=1"], ["lab?lowpower=1&nogate&noenvworker", "/lab?lowpower=1&nogate&noenvworker"], ["lab-optics-then-anatomy", "/lab#optics"]] : null;
for (const [label, url] of list ?? [["today", "/"], ["today?nogate", "/?nogate"], ["today?noenvworker", "/?noenvworker"], ["today?nogate&noenvworker", "/?nogate&noenvworker"],
  ["lab", "/lab"], ["lab?nogate", "/lab?nogate"], ["lab?nogate&noenvworker", "/lab?nogate&noenvworker"]]) {
  await page.goto(BASE + url.replace("#optics", ""), { waitUntil: "domcontentloaded" });
  if (url.endsWith("#optics")) { await sleep(3000); await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Optics")?.click()); await sleep(3000); await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Anatomy")?.click()); }
  const info = await (async () => { await sleep(2500); return page.evaluate(() => { const c = document.querySelector("canvas"); if (!c) return "no canvas"; const r = c.getBoundingClientRect(); return `canvas ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)} buf ${c.width}x${c.height}`; }); })();
  console.log("   ", label, info);
  const t0 = Date.now();
  let shown = null, last = 0;
  while (Date.now() - t0 < 15000) {
    last = await centreLit();
    if (last > 0.05) { shown = Date.now() - t0; break; }
    await sleep(500);
  }
  console.log(`${label.padEnd(28)} ${shown == null ? `NOT SHOWN after 15 s (centre lit ${(last * 100).toFixed(1)}%)` : `shown after ${shown} ms`}`);
}
if (only) { await page.goto(BASE + "/lab", { waitUntil: "networkidle2" }); await sleep(5000); const st = await page.evaluate(() => { const r = window.__r3f; return document.querySelector("canvas") ? "ok" : "none"; }); await page.mouse.move(900, 500); await page.mouse.wheel({ deltaY: 2000 }); await sleep(1500); console.log("after zoom-out lit:", (await centreLit()).toFixed(3)); }
console.log("console:", errs.length ? [...new Set(errs)].slice(0, 6) : "clean");
await browser.close();
