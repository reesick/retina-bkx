// Full-page screenshot of /evidence (scrolls through so lazy sections mount).
//   node qa/shot_evidence.mjs            -> real server http://127.0.0.1:8765
//   node qa/shot_evidence.mjs --mock     -> serves web/dist-mock from memory (build with: vite build --mode mock --outDir dist-mock)
// Optional: --click-failure opens the first failure card sheet. Output: ../logs/profile/evidence[-mock].png
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import puppeteer from "puppeteer-core";

const MOCK = process.argv.includes("--mock");
const BASE = MOCK ? "http://mock.local" : "http://127.0.0.1:8765";
const root = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", ...(fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d, "chrome-win64", "chrome.exe")) : [])].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, defaultViewport: { width: 1600, height: 1000 }, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
if (MOCK) {
  const dir = path.resolve("dist-mock");
  const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".ttf": "font/ttf", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.host !== "mock.local") return r.continue();
    let f = path.join(dir, decodeURIComponent(u.pathname));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, "index.html");
    r.respond({ status: 200, contentType: types[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
  });
}
await page.goto(BASE + "/evidence", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
const h = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < h + 2000; y += 600) { await page.evaluate((y) => window.scrollTo(0, y), y); await new Promise((r) => setTimeout(r, 250)); }
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 1500));
const out = path.resolve("..", "logs", "profile", `evidence${MOCK ? "-mock" : ""}.png`);
await page.screenshot({ path: out, fullPage: true });
const titles = await page.evaluate(() => [...document.querySelectorAll("h3")].map((e) => e.textContent));
console.log("sections:", titles.join(" | "));
const want = ["What the app actually decides", "By image quality", "Does the quality gate help?", "Patients, not photos", "New camera? Calibrate once", "Leakage check", "Smaller model test", "Where it fails", "Explanation tests"];
const handles = await page.$$("section");
for (const hd of handles) {
  const t = await hd.evaluate((e) => e.querySelector("h3")?.textContent || "");
  const parent = await hd.evaluate((e) => e.parentElement?.className || "");
  if (!want.includes(t)) continue;
  // for 2-up grids shoot the grid row so alignment is visible
  const target = /grid/.test(parent) ? await hd.evaluateHandle((e) => e.parentElement.closest(".grid") || e) : hd;
  await target.screenshot({ path: out.replace(".png", `-${t.replace(/\W+/g, "_").slice(0, 24)}.png`) });
}
if (process.argv.includes("--click-failure")) {
  const ok = await page.evaluate(() => { const b = document.querySelector('button[aria-label$=": details"]'); if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; });
  await new Promise((r) => setTimeout(r, 1200));
  if (ok) await page.screenshot({ path: out.replace(".png", "-sheet.png") });
  console.log("failure sheet:", ok);
}
console.log("errors:", errs.length ? errs.join("\n") : "none");
await browser.close();
