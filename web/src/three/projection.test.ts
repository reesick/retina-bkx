import { describe, expect, it } from "vitest";
import { angleDeg, imageToSphere, makeProjection, nerveDirection, POSTERIOR_POLE, sphereToImage } from "./projection";

describe("fundus -> globe projection", () => {
  const od = { fovea: { x: 0.46, y: 0.52 }, disc: { x: 0.79, y: 0.49 }, fovDeg: 45 };

  it("places the fovea at the posterior pole", () => {
    const p = makeProjection(od);
    expect(angleDeg(imageToSphere(p, od.fovea.x, od.fovea.y), POSTERIOR_POLE)).toBeLessThan(1e-6);
  });

  it("round-trips image -> sphere -> image", () => {
    const p = makeProjection(od);
    for (const [x, y] of [[0.5, 0.5], [0.2, 0.3], [0.8, 0.7], [0.62, 0.15]]) {
      const q = sphereToImage(p, imageToSphere(p, x, y));
      expect(q.x).toBeCloseTo(x, 6);
      expect(q.y).toBeCloseTo(y, 6);
      expect(q.inside).toBe(true);
    }
  });

  it("maps image +x to world +X and image +y to world -Y", () => {
    const p = makeProjection({ fovea: { x: 0.5, y: 0.5 }, disc: null, fovDeg: 45 });
    expect(imageToSphere(p, 0.8, 0.5)[0]).toBeGreaterThan(0);
    expect(imageToSphere(p, 0.5, 0.8)[1]).toBeLessThan(0);
  });

  it("lands a right-eye disc nasally (+X), within a few degrees of the optic nerve", () => {
    const p = makeProjection(od);
    const d = imageToSphere(p, od.disc.x, od.disc.y);
    expect(d[0]).toBeGreaterThan(0);
    expect(angleDeg(d, nerveDirection("OD"))).toBeLessThan(4);
  });

  it("scales θ when the disc–fovea angle is far from 15.5°", () => {
    const p = makeProjection({ fovea: { x: 0.5, y: 0.5 }, disc: { x: 0.62, y: 0.5 }, fovDeg: 45 });
    expect(p.scaled).toBe(true);
    const ang = angleDeg(imageToSphere(p, 0.62, 0.5), imageToSphere(p, 0.5, 0.5));
    expect(ang).toBeCloseTo(15.5, 1);
  });

  it("marks points outside the FOV as un-imaged", () => {
    const p = makeProjection(od);
    expect(sphereToImage(p, [0, 0, 1]).inside).toBe(false);
  });
});
