// Meridional ray tracing through the Le Grand full theoretical eye (2D, vector Snell's law).
// Pure functions, no DOM. Units: millimetres. Light travels along +x, the corneal apex is at x = 0, y is height.
//
// Le Grand (unaccommodated): the paraxial back focal point lies 16.5966 mm behind the posterior lens vertex, i.e.
// 24.1966 mm from the corneal apex. The slider default axial length of 24.2 mm is therefore emmetropic to within
// 0.004 mm (well inside the 0.2 mm tolerance) and no adjustment of the default is needed.

export interface Vec2 { x: number; y: number }

export interface Surface {
  name: string;
  /** Vertex position on the axis (mm from the corneal apex). */
  x: number;
  /** Signed radius of curvature; positive = centre of curvature behind the vertex (+x). */
  R: number;
  /** Refractive index after the surface. */
  nAfter: number;
  /** Semi-aperture used for drawing and as a physical limit. */
  semi: number;
}

export interface EyeParams {
  /** Axial length, corneal apex to retina vertex (mm). Slider 21–28. */
  axialLength: number;
  /** Accommodation 0–8 D (geometry interpolated towards the Le Grand accommodated eye). */
  accommodation: number;
  /** Pupil diameter 2–8 mm. */
  pupil: number;
}

export interface EyeModel {
  surfaces: Surface[];
  retina: { x: number; R: number };
  /** Aperture stop plane (iris), at the anterior lens vertex. */
  stopX: number;
  pupil: number;
  nAir: number;
}

export const LE_GRAND = {
  corneaFrontR: 7.8, corneaBackR: 6.5, corneaT: 0.55, chamber: 3.05,
  lensFrontR: 10.2, lensBackR: -6.0, lensT: 4.0, vitreous: 16.5966,
  nCornea: 1.3771, nAqueous: 1.3374, nLens: 1.42, nVitreous: 1.336, retinaR: -12,
} as const;

/** Distance from the corneal apex to the paraxial focus of the unaccommodated Le Grand eye. */
export const LE_GRAND_EMMETROPIC_AXIAL =
  LE_GRAND.corneaT + LE_GRAND.chamber + LE_GRAND.lensT + LE_GRAND.vitreous; // 24.1966

export const DEFAULT_EYE: EyeParams = { axialLength: 24.2, accommodation: 0, pupil: 4 };
export const SPECTACLE_PLANE = 12; // mm in front of the cornea

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function buildEye(p: EyeParams): EyeModel {
  const s = Math.max(0, Math.min(8, p.accommodation)) / 8;
  const lensFrontR = lerp(LE_GRAND.lensFrontR, 5.0, s);
  const lensBackR = lerp(LE_GRAND.lensBackR, -5.0, s);
  const lensT = lerp(LE_GRAND.lensT, 4.5, s);
  const chamber = LE_GRAND.chamber - (lensT - LE_GRAND.lensT); // anterior chamber shrinks by the same amount
  const x2 = LE_GRAND.corneaT;
  const x3 = x2 + chamber;
  const x4 = x3 + lensT;
  return {
    surfaces: [
      { name: "Anterior cornea", x: 0, R: LE_GRAND.corneaFrontR, nAfter: LE_GRAND.nCornea, semi: 5.85 },
      { name: "Posterior cornea", x: x2, R: LE_GRAND.corneaBackR, nAfter: LE_GRAND.nAqueous, semi: 5.6 },
      { name: "Anterior lens", x: x3, R: lensFrontR, nAfter: LE_GRAND.nLens, semi: 4.5 },
      { name: "Posterior lens", x: x4, R: lensBackR, nAfter: LE_GRAND.nVitreous, semi: 4.5 },
    ],
    retina: { x: p.axialLength, R: LE_GRAND.retinaR },
    stopX: x3,
    pupil: p.pupil,
    nAir: 1.0,
  };
}

// ------------------------------------------------------------------ vector maths
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const norm = (a: Vec2): Vec2 => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** Vector Snell: t = η i + (η cosθi − cosθt) n, with n facing the incident ray. Returns null on TIR. */
export function refract(i: Vec2, nIn: Vec2, n1: number, n2: number): Vec2 | null {
  let n = nIn;
  let cosi = -dot(n, i);
  if (cosi < 0) {
    n = { x: -n.x, y: -n.y };
    cosi = -cosi;
  }
  const eta = n1 / n2;
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const cost = Math.sqrt(k);
  return norm({ x: eta * i.x + (eta * cosi - cost) * n.x, y: eta * i.y + (eta * cosi - cost) * n.y });
}

export function reflect(i: Vec2, n: Vec2): Vec2 {
  const d = dot(i, n);
  return { x: i.x - 2 * d * n.x, y: i.y - 2 * d * n.y };
}

/** Intersection of a ray with the spherical surface (vertex vx, radius R). Picks the cap near the vertex. */
function hitSphere(p: Vec2, d: Vec2, vx: number, R: number, far = false): { t: number; n: Vec2 } | null {
  const cx = vx + R;
  const ox = p.x - cx, oy = p.y;
  const b = ox * d.x + oy * d.y;
  const c = ox * ox + oy * oy - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const ts = [-b - sq, -b + sq].filter((t) => t > 1e-9);
  if (!ts.length) return null;
  let t: number;
  if (far) t = Math.max(...ts);
  else {
    // the root whose hit point is closer to the vertex (the physical cap)
    t = ts.reduce((best, tt) => (Math.abs(p.x + tt * d.x - vx) < Math.abs(p.x + best * d.x - vx) ? tt : best), ts[0]);
  }
  const h = { x: p.x + t * d.x, y: p.y + t * d.y };
  return { t, n: norm({ x: h.x - cx, y: h.y }) };
}

export interface ThinLens { x: number; power: number /* dioptres */ }

export interface TracedRay {
  points: Vec2[];
  /** Blocked by the iris (outside the pupil) or by TIR / missing a surface. */
  blocked: boolean;
  /** Where it lands on the retina, if it gets there. */
  retina: Vec2 | null;
  /** Last position and direction inside the vitreous (for focus computations). */
  last: { p: Vec2; d: Vec2 } | null;
}

/** Trace one meridional ray from `origin` with direction `dir`. */
export function traceRay(eye: EyeModel, origin: Vec2, dir: Vec2, lens?: ThinLens | null, ignoreStop = false): TracedRay {
  let p = { ...origin };
  let d = norm(dir);
  const points: Vec2[] = [p];
  if (lens && p.x < lens.x && d.x > 0) {
    const t = (lens.x - p.x) / d.x;
    p = { x: lens.x, y: p.y + t * d.y };
    points.push(p);
    // paraxial thin lens in slope space: u' = u − y·P (P in 1/mm)
    const u = d.y / d.x - (p.y * lens.power) / 1000;
    d = norm({ x: 1, y: u });
  }
  let n1 = eye.nAir;
  for (let k = 0; k < eye.surfaces.length; k++) {
    const s = eye.surfaces[k];
    if (k === 2 && !ignoreStop) {
      // aperture stop just before the anterior lens
      const t = (eye.stopX - p.x) / d.x;
      const ys = p.y + t * d.y;
      if (Math.abs(ys) > eye.pupil / 2) {
        points.push({ x: eye.stopX, y: ys });
        return { points, blocked: true, retina: null, last: null };
      }
    }
    const h = hitSphere(p, d, s.x, s.R);
    if (!h) return { points, blocked: true, retina: null, last: null };
    p = { x: p.x + h.t * d.x, y: p.y + h.t * d.y };
    points.push(p);
    if (Math.abs(p.y) > s.semi + 0.6) return { points, blocked: true, retina: null, last: null };
    const t = refract(d, h.n, n1, s.nAfter);
    if (!t) {
      d = norm(reflect(d, h.n));
      return { points, blocked: true, retina: null, last: null };
    }
    d = t;
    n1 = s.nAfter;
  }
  const last = { p, d };
  const r = hitSphere(p, d, eye.retina.x, eye.retina.R, true);
  if (!r) return { points, blocked: false, retina: null, last };
  const hit = { x: p.x + r.t * d.x, y: p.y + r.t * d.y };
  points.push(hit);
  return { points, blocked: false, retina: hit, last };
}

/** Starting ray for an object at `objectDist` mm in front of the cornea (Infinity = parallel), at height h at the cornea. */
function startRay(objectDist: number, h: number, fromX: number): { o: Vec2; d: Vec2 } {
  if (!Number.isFinite(objectDist)) return { o: { x: fromX, y: h }, d: { x: 1, y: 0 } };
  const o = { x: -objectDist, y: 0 };
  return { o, d: norm({ x: 0 - o.x, y: h }) };
}

/**
 * Paraxial image position (x, mm from the corneal apex) for an on-axis object at `objectDist`
 * (Infinity = distant), optionally with a thin trial lens. Returns NaN if the rays diverge.
 */
export function paraxialFocus(eye: EyeModel, objectDist = Infinity, lens?: ThinLens | null): number {
  const h = 1e-3;
  const { o, d } = startRay(objectDist, h, -SPECTACLE_PLANE - 5);
  const r = traceRay(eye, o, d, lens, true);
  if (!r.last) return NaN;
  const { p, d: dd } = r.last;
  if (Math.abs(dd.y) < 1e-15) return Infinity;
  const t = -p.y / dd.y;
  return p.x + t * dd.x;
}

/** Focus position relative to the retina vertex (mm). Negative = in front of the retina (myopic). */
export function focusError(eye: EyeModel, objectDist = Infinity, lens?: ThinLens | null): number {
  const f = paraxialFocus(eye, objectDist, lens);
  return f - eye.retina.x;
}

/**
 * Trial-lens power (D) at the spectacle plane that puts the paraxial focus on the retina, by bisection over
 * −10…+10 D. Returns null if outside the range.
 */
export function trialLens(eye: EyeModel, objectDist = Infinity, lo = -10, hi = 10): number | null {
  const f = (P: number) => focusError(eye, objectDist, { x: -SPECTACLE_PLANE, power: P });
  let a = lo, b = hi, fa = f(a), fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return null;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fa * fm <= 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  void fb;
  return (a + b) / 2;
}

/** Refractive error (D) of the eye: trial lens for a distant object with accommodation relaxed. */
export function refractiveError(p: EyeParams): number | null {
  return trialLens(buildEye({ ...p, accommodation: 0 }), Infinity);
}

export function refractiveLabel(D: number | null): string {
  if (D == null) return "Beyond ±10 D";
  if (Math.abs(D) < 0.25) return "Emmetropic";
  const v = (Math.round(D * 4) / 4).toFixed(2).replace(/\.00$/, ".0").replace(/0$/, "");
  return D < 0 ? `Myopic −${v.replace("-", "")} D` : `Hyperopic +${v} D`;
}

/** Height at the cornea of the marginal ray that just grazes the pupil edge (bisection). */
export function marginalHeight(eye: EyeModel, objectDist = Infinity, lens?: ThinLens | null): number {
  const yAtStop = (h: number) => {
    const { o, d } = startRay(objectDist, h, -SPECTACLE_PLANE - 5);
    const r = traceRay(eye, o, d, lens, true);
    // position at the stop plane: points[...] includes the hit on surface 3 at stopX (approximately)
    const pts = r.points;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x >= eye.stopX && pts[i - 1].x <= eye.stopX) {
        const a = pts[i - 1], b = pts[i];
        const t = (eye.stopX - a.x) / (b.x - a.x || 1);
        return a.y + t * (b.y - a.y);
      }
    }
    return NaN;
  };
  let a = 0, b = 6;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    const y = yAtStop(m);
    if (!Number.isFinite(y) || Math.abs(y) > eye.pupil / 2) b = m;
    else a = m;
  }
  return a;
}

export interface Fan { rays: TracedRay[]; blurDiameter: number; focusX: number; objectDist: number }

/** A fan of `n` meridional rays filling the pupil; blur diameter is the spread of retinal hits (mm). */
export function traceFan(eye: EyeModel, objectDist = Infinity, n = 13, lens?: ThinLens | null): Fan {
  const hm = marginalHeight(eye, objectDist, lens) * 0.999;
  const rays: TracedRay[] = [];
  for (let i = 0; i < n; i++) {
    const h = n === 1 ? 0 : -hm + (2 * hm * i) / (n - 1);
    const { o, d } = startRay(objectDist, h, -SPECTACLE_PLANE - 18);
    rays.push(traceRay(eye, o, d, lens));
  }
  const ys = rays.filter((r) => r.retina).map((r) => r.retina!.y);
  const blur = ys.length > 1 ? Math.max(...ys) - Math.min(...ys) : 0;
  return { rays, blurDiameter: blur, focusX: paraxialFocus(eye, objectDist, lens), objectDist };
}
