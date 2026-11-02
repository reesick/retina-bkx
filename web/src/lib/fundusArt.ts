// Procedural fundus-like pictures for mock mode and the Eye Lab. Canvas only, no network, deterministic per seed.
// These are illustrations, never patient images.
import type { Eye, Lesion, LesionType } from "../api/types";
import { rng } from "./rng";

export interface FundusSpec {
  seed: number;
  eye: Eye;
  fovea: { x: number; y: number };
  disc: { x: number; y: number };
  /** Disc diameter, normalised. */
  dd: number;
  lesions: Lesion[];
  /** 1 = normal light; < 1 darker. */
  light?: number;
  /** Gaussian blur in px at 512. */
  blur?: number;
  /** Eyelash / dust artefact. */
  artefact?: boolean;
  /** Crop the field (field definition failure). */
  fieldShift?: { x: number; y: number };
  /** Hue variation 0..1 (pigmentation). */
  tone?: number;
  /** Neovascular tufts (proliferative DR illustration). */
  nv?: boolean;
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  return [c, g];
}

interface Walker { x: number; y: number; a: number; w: number; len: number; curv: number; depth: number }

function drawVessels(g: CanvasRenderingContext2D, S: number, spec: FundusSpec, rand: () => number) {
  const { disc, fovea } = spec;
  const tdir = fovea.x < disc.x ? -1 : 1; // temporal direction (toward the fovea)
  const fx = fovea.x * S, fy = fovea.y * S;
  const R = 0.47 * S;
  const step = S * 0.011;
  const strokes: { pts: [number, number][]; w: number; vein: boolean }[] = [];

  const grow = (wk: Walker, vein: boolean) => {
    const pts: [number, number][] = [[wk.x, wk.y]];
    let { x, y, a } = wk;
    const n = Math.round(wk.len);
    for (let i = 0; i < n; i++) {
      a += wk.curv + (rand() - 0.5) * 0.22;
      // vessels avoid the fovea: steer away when close
      const dx = x - fx, dy = y - fy;
      const dist = Math.hypot(dx, dy);
      if (dist < S * 0.11) {
        const away = Math.atan2(dy, dx);
        let diff = away - a;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        a += diff * 0.25;
      }
      if (dist < S * 0.035) break;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      if (Math.hypot(x - S / 2, y - S / 2) > R * 1.02) break;
      pts.push([x, y]);
      if (wk.depth > 0 && i > 3 && i % (5 + Math.floor(rand() * 5)) === 0) {
        const side = rand() < 0.5 ? -1 : 1;
        grow(
          { x, y, a: a + side * (0.45 + rand() * 0.6), w: wk.w * (0.55 + rand() * 0.15), len: wk.len * (0.35 + rand() * 0.3),
            curv: (rand() - 0.5) * 0.06, depth: wk.depth - 1 },
          vein,
        );
      }
    }
    strokes.push({ pts, w: wk.w, vein });
  };

  const dx = disc.x * S, dy = disc.y * S;
  const W = S * 0.0105;
  const arcade = (sup: boolean, vein: boolean) => {
    const a0 = (sup ? -Math.PI / 2 : Math.PI / 2) + tdir * (sup ? 0.1 : -0.1) + (vein ? 0.12 : -0.12);
    // superior arcade turns toward temporal going up, inferior going down: both arc around the macula
    const curv = (sup ? 1 : -1) * tdir * 0.045;
    grow({ x: dx, y: dy + (sup ? -1 : 1) * S * 0.01, a: a0, w: vein ? W * 1.25 : W, len: 58, curv, depth: 3 }, vein);
  };
  arcade(true, true); arcade(true, false); arcade(false, true); arcade(false, false);
  // nasal vessels
  for (const sup of [true, false]) {
    for (const vein of [true, false]) {
      grow({ x: dx, y: dy, a: (tdir < 0 ? 0 : Math.PI) + (sup ? -0.7 : 0.7) + (vein ? 0.15 : -0.15), w: W * 0.8, len: 30,
        curv: (rand() - 0.5) * 0.02, depth: 2 }, vein);
    }
  }
  // small macular branches toward the fovea
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2;
    const sx = fx + Math.cos(ang) * S * 0.2, sy = fy + Math.sin(ang) * S * 0.2;
    grow({ x: sx, y: sy, a: ang + Math.PI + (rand() - 0.5) * 0.6, w: W * 0.35, len: 12, curv: 0, depth: 0 }, rand() < 0.5);
  }

  g.lineCap = "round";
  g.lineJoin = "round";
  const path = (pts: [number, number][]) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const l = pts[pts.length - 1];
    g.lineTo(l[0], l[1]);
  };
  for (const s of strokes.sort((a, b) => b.w - a.w)) {
    if (s.pts.length < 2) continue;
    path(s.pts);
    g.strokeStyle = s.vein ? "rgba(92,10,8,0.82)" : "rgba(150,28,18,0.72)";
    g.lineWidth = s.w;
    g.stroke();
    if (s.w > W * 0.6) {
      path(s.pts);
      g.strokeStyle = s.vein ? "rgba(190,70,50,0.25)" : "rgba(240,140,100,0.35)";
      g.lineWidth = s.w * 0.28;
      g.stroke();
    }
  }
}

function lesionShapes(l: Lesion, S: number): { cx: number; cy: number; rx: number; ry: number; blobs: [number, number, number][] } {
  const r = rng(parseInt(l.id.replace(/\D/g, "").slice(-8) || "1", 10) + l.type.charCodeAt(0) * 7919);
  const [x, y, w, h] = l.bbox;
  const cx = (x + w / 2) * S, cy = (y + h / 2) * S, rx = (w / 2) * S, ry = (h / 2) * S;
  const blobs: [number, number, number][] = [];
  const n = l.type === "MA" ? 1 : l.type === "EX" ? 3 + Math.floor(r() * 4) : 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2, rad = i === 0 ? 0 : r() * 0.55;
    blobs.push([cx + Math.cos(ang) * rx * rad, cy + Math.sin(ang) * ry * rad, Math.min(rx, ry) * (i === 0 ? 0.85 : 0.35 + r() * 0.45)]);
  }
  return { cx, cy, rx, ry, blobs };
}

function drawLesion(g: CanvasRenderingContext2D, l: Lesion, S: number) {
  const s = lesionShapes(l, S);
  for (const [bx, by, br] of s.blobs) {
    const rr = Math.max(br, S * 0.0025);
    const grd = g.createRadialGradient(bx, by, 0, bx, by, rr);
    if (l.type === "MA") { grd.addColorStop(0, "rgba(110,0,8,1)"); grd.addColorStop(0.8, "rgba(120,5,10,0.95)"); grd.addColorStop(1, "rgba(120,5,10,0)"); }
    else if (l.type === "HE") { grd.addColorStop(0, "rgba(95,4,6,0.95)"); grd.addColorStop(0.7, "rgba(110,10,8,0.8)"); grd.addColorStop(1, "rgba(110,10,8,0)"); }
    else if (l.type === "EX") { grd.addColorStop(0, "rgba(255,236,150,1)"); grd.addColorStop(0.6, "rgba(240,200,90,0.9)"); grd.addColorStop(1, "rgba(230,180,60,0)"); }
    else { grd.addColorStop(0, "rgba(250,240,225,0.85)"); grd.addColorStop(0.6, "rgba(235,215,190,0.5)"); grd.addColorStop(1, "rgba(230,200,170,0)"); }
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(bx, by, rr * (l.type === "HE" ? 1.3 : 1), rr, 0, 0, Math.PI * 2);
    g.fill();
  }
}

export function drawFundus(spec: FundusSpec, S = 512): HTMLCanvasElement {
  const [c, g] = canvas(S);
  const rand = rng(spec.seed);
  const R = 0.47 * S;
  const light = spec.light ?? 1;
  const tone = spec.tone ?? rand();
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  g.save();
  if (spec.fieldShift) g.translate(spec.fieldShift.x * S, spec.fieldShift.y * S);
  g.beginPath();
  g.arc(S / 2, S / 2, R, 0, Math.PI * 2);
  g.clip();
  // base: orange-red with a darker vignette
  const base = g.createRadialGradient(S * 0.5, S * 0.47, R * 0.05, S / 2, S / 2, R);
  const r0 = Math.round(214 - tone * 30), g0 = Math.round(92 - tone * 25), b0 = Math.round(40 - tone * 15);
  base.addColorStop(0, `rgb(${r0},${g0},${b0})`);
  base.addColorStop(0.55, `rgb(${r0 - 30},${g0 - 40},${b0 - 18})`);
  base.addColorStop(0.9, `rgb(${r0 - 95},${g0 - 70},${b0 - 30})`);
  base.addColorStop(1, "rgb(40,8,4)");
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  // choroidal texture
  for (let i = 0; i < 260; i++) {
    const x = rand() * S, y = rand() * S, r = S * (0.01 + rand() * 0.04);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.5;
    gr.addColorStop(0, dark ? "rgba(90,20,10,0.10)" : "rgba(255,150,90,0.07)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // macula: darker pigmented disc and foveal reflex
  const fx = spec.fovea.x * S, fy = spec.fovea.y * S;
  const mac = g.createRadialGradient(fx, fy, 0, fx, fy, S * 0.12);
  mac.addColorStop(0, "rgba(60,10,4,0.65)");
  mac.addColorStop(0.5, "rgba(80,18,8,0.35)");
  mac.addColorStop(1, "rgba(80,18,8,0)");
  g.fillStyle = mac;
  g.fillRect(0, 0, S, S);
  g.fillStyle = "rgba(255,210,160,0.35)";
  g.beginPath();
  g.arc(fx, fy, S * 0.004, 0, Math.PI * 2);
  g.fill();
  // optic disc
  const dx = spec.disc.x * S, dy = spec.disc.y * S, dr = (spec.dd / 2) * S;
  const halo = g.createRadialGradient(dx, dy, dr * 0.5, dx, dy, dr * 2.2);
  halo.addColorStop(0, "rgba(255,200,140,0.5)");
  halo.addColorStop(1, "rgba(255,170,110,0)");
  g.fillStyle = halo;
  g.fillRect(dx - dr * 3, dy - dr * 3, dr * 6, dr * 6);
  const disc = g.createRadialGradient(dx + dr * 0.15, dy, 0, dx, dy, dr);
  disc.addColorStop(0, "rgba(255,248,220,1)");
  disc.addColorStop(0.45, "rgba(255,226,160,1)");
  disc.addColorStop(0.9, "rgba(240,170,100,0.95)");
  disc.addColorStop(1, "rgba(220,130,70,0)");
  g.fillStyle = disc;
  g.beginPath();
  g.ellipse(dx, dy, dr * 0.92, dr, 0, 0, Math.PI * 2);
  g.fill();
  drawVessels(g, S, spec, rand);
  // cup
  const cup = g.createRadialGradient(dx + dr * 0.12, dy, 0, dx + dr * 0.12, dy, dr * 0.45);
  cup.addColorStop(0, "rgba(255,255,240,0.9)");
  cup.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = cup;
  g.fillRect(dx - dr, dy - dr, dr * 2, dr * 2);
  for (const l of spec.lesions) drawLesion(g, l, S);
  if (spec.nv) {
    // fine tortuous new vessels at the disc and along the superior arcade
    const tufts: [number, number][] = [[dx, dy - dr * 0.4], [dx + (spec.fovea.x < spec.disc.x ? -1 : 1) * S * 0.12, dy - S * 0.15]];
    g.strokeStyle = "rgba(170,20,25,0.9)";
    g.lineWidth = S * 0.0022;
    for (const [tx, ty] of tufts) {
      for (let k = 0; k < 14; k++) {
        g.beginPath();
        let x = tx, y = ty;
        g.moveTo(x, y);
        for (let s = 0; s < 8; s++) {
          const nx = x + (rand() - 0.5) * S * 0.03, ny = y + (rand() - 0.5) * S * 0.03;
          g.quadraticCurveTo(x + (rand() - 0.5) * S * 0.02, y + (rand() - 0.5) * S * 0.02, nx, ny);
          x = nx; y = ny;
        }
        g.stroke();
      }
    }
  }
  if (spec.artefact) {
    g.strokeStyle = "rgba(10,5,5,0.55)";
    g.lineWidth = S * 0.012;
    g.beginPath();
    g.moveTo(S * 0.1, S * 0.2);
    g.bezierCurveTo(S * 0.3, S * 0.1, S * 0.5, S * 0.35, S * 0.62, S * 0.18);
    g.stroke();
  }
  // rim vignette
  const vig = g.createRadialGradient(S / 2, S / 2, R * 0.75, S / 2, S / 2, R);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.6)");
  g.fillStyle = vig;
  g.fillRect(0, 0, S, S);
  if (light < 1) {
    g.fillStyle = `rgba(0,0,0,${1 - light})`;
    g.fillRect(0, 0, S, S);
  }
  g.restore();
  if (spec.blur) {
    const [c2, g2] = canvas(S);
    g2.filter = `blur(${(spec.blur * S) / 512}px)`;
    g2.drawImage(c, 0, 0);
    return c2;
  }
  return c;
}

// ------------------------------------------------------------------ overlays

const MAGMA: [number, number, number, number][] = [
  [0, 0, 0, 4], [0.13, 28, 16, 68], [0.25, 79, 18, 123], [0.38, 129, 37, 129], [0.5, 181, 54, 122],
  [0.63, 229, 80, 100], [0.75, 251, 135, 97], [0.88, 254, 194, 135], [1, 252, 253, 191],
];
export function magma(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < MAGMA.length; i++) {
    if (x <= MAGMA[i][0]) {
      const a = MAGMA[i - 1], b = MAGMA[i];
      const u = (x - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
    }
  }
  return [252, 253, 191];
}

export function drawHeat(spec: FundusSpec, kind: "cam" | "attention", S = 384): HTMLCanvasElement {
  const [c, g] = canvas(S);
  const rand = rng(spec.seed * 31 + (kind === "cam" ? 1 : 2));
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = "lighter";
  const blob = (x: number, y: number, r: number, a: number) => {
    const gr = g.createRadialGradient(x * S, y * S, 0, x * S, y * S, r * S);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  };
  const W: Record<LesionType, number> = { MA: 0.25, HE: 0.5, EX: 0.45, SE: 0.35 };
  for (const l of spec.lesions.slice(0, 60)) {
    blob(l.centroid[0], l.centroid[1], kind === "cam" ? 0.09 : 0.05, W[l.type] * (kind === "cam" ? 0.7 : 0.9));
  }
  blob(spec.disc.x, spec.disc.y, 0.08, kind === "cam" ? 0.18 : 0.3);
  blob(spec.fovea.x, spec.fovea.y, 0.1, 0.15);
  for (let i = 0; i < (kind === "cam" ? 3 : 10); i++) blob(0.25 + rand() * 0.5, 0.25 + rand() * 0.5, 0.05 + rand() * 0.06, 0.12);
  g.globalCompositeOperation = "source-over";
  const id = g.getImageData(0, 0, S, S);
  const d = id.data;
  const patch = kind === "attention" ? Math.round(S / 27) : 1; // ViT 14px patches on 384 ≈ 27 patches
  const src = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) src[i] = d[i * 4] / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = patch > 1 ? Math.floor(x / patch) * patch + (patch >> 1) : x;
      const py = patch > 1 ? Math.floor(y / patch) * patch + (patch >> 1) : y;
      const v = Math.pow(Math.min(1, src[Math.min(S - 1, py) * S + Math.min(S - 1, px)] * 1.4), 0.9);
      const inside = Math.hypot(x / S - 0.5, y / S - 0.5) < 0.47;
      const [r, gg, b] = magma(v);
      const o = (y * S + x) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b;
      d[o + 3] = inside ? Math.round(Math.min(1, v * 1.3) * 0.55 * 255) : 0;
    }
  }
  g.putImageData(id, 0, 0);
  return c;
}

const LCOL: Record<LesionType, string> = { MA: "255,55,95", HE: "255,69,58", EX: "255,214,10", SE: "229,229,234" };

export function drawLesionMask(spec: FundusSpec, type: LesionType | "all", S = 384): HTMLCanvasElement {
  const [c, g] = canvas(S);
  g.clearRect(0, 0, S, S);
  for (const l of spec.lesions) {
    if (type !== "all" && l.type !== type) continue;
    const s = lesionShapes(l, S);
    g.fillStyle = `rgba(${LCOL[l.type]},0.85)`;
    for (const [bx, by, br] of s.blobs) {
      g.beginPath();
      g.ellipse(bx, by, Math.max(br, 1.2) * (l.type === "HE" ? 1.3 : 1), Math.max(br, 1.2), 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

export const toJpeg = (c: HTMLCanvasElement, q = 0.88) => c.toDataURL("image/jpeg", q);
export const toPng = (c: HTMLCanvasElement) => c.toDataURL("image/png");
