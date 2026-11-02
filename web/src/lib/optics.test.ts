import { describe, expect, it } from "vitest";
import {
  buildEye, DEFAULT_EYE, focusError, LE_GRAND_EMMETROPIC_AXIAL, paraxialFocus, refract, refractiveError,
  refractiveLabel, traceFan, trialLens,
} from "./optics";

describe("Le Grand schematic eye", () => {
  it("focuses parallel paraxial rays within 0.2 mm of the retina at 24.2 mm axial length", () => {
    const eye = buildEye(DEFAULT_EYE);
    expect(DEFAULT_EYE.axialLength).toBe(24.2);
    const err = focusError(eye, Infinity);
    expect(Math.abs(err)).toBeLessThan(0.2);
  });

  it("puts the paraxial focus at the textbook 24.197 mm from the corneal apex", () => {
    const f = paraxialFocus(buildEye(DEFAULT_EYE), Infinity);
    expect(Math.abs(f - LE_GRAND_EMMETROPIC_AXIAL)).toBeLessThan(0.05);
  });

  it("reads emmetropic by default, myopic when long, hyperopic when short", () => {
    expect(refractiveLabel(refractiveError(DEFAULT_EYE))).toBe("Emmetropic");
    const myo = refractiveError({ ...DEFAULT_EYE, axialLength: 25.2 });
    const hyp = refractiveError({ ...DEFAULT_EYE, axialLength: 23.2 });
    expect(myo).not.toBeNull();
    expect(hyp).not.toBeNull();
    expect(myo!).toBeLessThan(-1.5); // ~ −2.7 D per mm
    expect(hyp!).toBeGreaterThan(1.5);
  });

  it("the trial lens actually corrects the focus", () => {
    const eye = buildEye({ ...DEFAULT_EYE, axialLength: 26 });
    const P = trialLens(eye, Infinity)!;
    expect(Math.abs(focusError(eye, Infinity, { x: -12, power: P }))).toBeLessThan(0.01);
  });

  it("accommodation moves the focus forward (more power)", () => {
    const a0 = paraxialFocus(buildEye(DEFAULT_EYE));
    const a8 = paraxialFocus(buildEye({ ...DEFAULT_EYE, accommodation: 8 }));
    expect(a8).toBeLessThan(a0);
  });

  it("near objects focus behind the relaxed retina", () => {
    expect(focusError(buildEye(DEFAULT_EYE), 250)).toBeGreaterThan(0.5);
  });

  it("fan rays respect the pupil and land on the retina", () => {
    const fan = traceFan(buildEye(DEFAULT_EYE), Infinity, 9);
    expect(fan.rays.every((r) => !r.blocked && r.retina)).toBe(true);
    expect(fan.blurDiameter).toBeLessThan(0.2);
  });

  it("handles total internal reflection", () => {
    const i = { x: Math.SQRT1_2, y: Math.SQRT1_2 }; // 45° from glass to air
    expect(refract(i, { x: -1, y: 0 }, 1.5, 1.0)).toBeNull();
  });
});
