// Fundus -> globe projection (docs/05_UI_UX.md §4). Pure maths shared by the retina shader (uniforms) and the
// click-to-select inverse mapping, so 2D and 3D always agree.
//
// Unit sphere centred at the eye centre; the eye looks toward +Z, up = +Y, posterior pole P = (0,0,-1).
// Image +x -> world +X, image +y (down) -> world -Y. The canonical image centre c=(0.5,0.5) is the camera axis A and
// the fundus circle radius r=0.5 corresponds to FOV/2. The fovea is placed at P, so A is P rotated by the fovea's own
// offset (θf, φf) in the opposite direction.

export type V3 = [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V3): V3 => scale(a, 1 / (len(a) || 1));

/** Rodrigues rotation of v around unit axis k by angle a. */
function rotate(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

export const POSTERIOR_POLE: V3 = [0, 0, -1];
export const DISC_FOVEA_DEG = 15.5;
const DEG = Math.PI / 180;
const C = 0.5, R = 0.5;

export interface Projection {
  /** Camera axis on the unit sphere. */
  A: V3;
  /** World directions of image +x and image +y in A's tangent plane. */
  Ex: V3; Ey: V3;
  /** Half field of view in radians after disc–fovea scaling. */
  halfFov: number;
  /** θ multiplier applied (1 = unscaled). */
  thetaScale: number;
  scaled: boolean;
  /** Disc–fovea angle before scaling (degrees). */
  discFoveaDegRaw: number;
  fovDeg: number;
}

export interface ProjectionInput {
  fovea: { x: number; y: number };
  disc: { x: number; y: number } | null;
  fovDeg: number;
}

/** Image offset (normalised) -> tangent direction in the P frame (before rotation). */
const tangentP = (ox: number, oy: number): V3 => [ox, -oy, 0];

export function makeProjection({ fovea, disc, fovDeg }: ProjectionInput, toleranceDeg = 2.5): Projection {
  const half0 = (fovDeg / 2) * DEG;
  const fo: [number, number] = [fovea.x - C, fovea.y - C];
  const thF = (Math.hypot(fo[0], fo[1]) / R) * half0;

  // Camera axis A: rotate P by θf against the fovea's tangent direction. Use the same rotation for the frame.
  let A: V3 = POSTERIOR_POLE, Ex: V3 = [1, 0, 0], Ey: V3 = [0, -1, 0];
  if (thF > 1e-9) {
    const ef = normalize(tangentP(fo[0], fo[1]));
    const target = normalize(add(scale(POSTERIOR_POLE, Math.cos(thF)), scale(ef, -Math.sin(thF))));
    const k = normalize(cross(POSTERIOR_POLE, target));
    A = target;
    Ex = rotate(Ex, k, thF);
    Ey = rotate(Ey, k, thF);
  }

  const base: Projection = { A, Ex, Ey, halfFov: half0, thetaScale: 1, scaled: false, discFoveaDegRaw: NaN, fovDeg };
  if (!disc) return base;
  const dDir = imageToSphere(base, disc.x, disc.y);
  const fDir = imageToSphere(base, fovea.x, fovea.y);
  const ang = Math.acos(Math.max(-1, Math.min(1, dot(dDir, fDir)))) / DEG;
  base.discFoveaDegRaw = ang;
  if (ang > 1 && Math.abs(ang - DISC_FOVEA_DEG) > toleranceDeg) {
    // Scale θ so the disc–fovea angle equals the anatomical average. Recompute with the scaled half-FOV.
    const s = DISC_FOVEA_DEG / ang;
    const p2 = makeProjection({ fovea, disc: null, fovDeg: fovDeg * s });
    return { ...p2, thetaScale: s, scaled: true, discFoveaDegRaw: ang, fovDeg };
  }
  return base;
}

/** Image point (normalised) -> unit direction on the sphere. */
export function imageToSphere(p: Projection, qx: number, qy: number): V3 {
  const ox = qx - C, oy = qy - C;
  const rr = Math.hypot(ox, oy);
  if (rr < 1e-12) return p.A;
  const th = (rr / R) * p.halfFov;
  const dir = normalize(add(scale(p.Ex, ox / rr), scale(p.Ey, oy / rr)));
  return normalize(add(scale(p.A, Math.cos(th)), scale(dir, Math.sin(th))));
}

/** Unit direction -> image point; `inside` is false outside the imaged cap. Mirrors the retina shader. */
export function sphereToImage(p: Projection, d: V3): { x: number; y: number; inside: boolean; theta: number } {
  const u = normalize(d);
  const cs = Math.max(-1, Math.min(1, dot(u, p.A)));
  const th = Math.acos(cs);
  const t = add(u, scale(p.A, -cs));
  const tx = dot(t, p.Ex), ty = dot(t, p.Ey);
  const tl = Math.hypot(tx, ty) || 1;
  const rr = (th / p.halfFov) * R;
  const x = C + (rr * tx) / tl, y = C + (rr * ty) / tl;
  return { x, y, inside: th <= p.halfFov && Math.hypot(x - C, y - C) <= R, theta: th };
}

/** Anatomical optic nerve head direction: 15° nasal of the posterior pole, slightly superior. */
export function nerveDirection(eye: "OD" | "OS", nasalDeg = 15.5, upDeg = 1.5): V3 {
  const sx = eye === "OD" ? 1 : -1;
  const a = nasalDeg * DEG, b = upDeg * DEG;
  return normalize([sx * Math.sin(a), Math.sin(b), -Math.cos(a) * Math.cos(b)]);
}

export function angleDeg(a: V3, b: V3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))))) / DEG;
}
