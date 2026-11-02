// Eye Lab scenes: Anatomy, DR stages (illustration), Coverage.
import { Html, OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { analyse } from "../api/fixtures";
import type { Grade } from "../api/types";
import { drawFundus } from "../lib/fundusArt";
import { EyeModel, PART_INFO, type PartName } from "./EyeModel";
import { makeProjection, nerveDirection, POSTERIOR_POLE, type V3 } from "./projection";
import { canvasTexture, Stage } from "./Stage";

// ------------------------------------------------------------------ anatomy
export function AnatomyScene({ explode, section, irisColor, className = "" }: { explode: number; section: number; irisColor: string; className?: string }) {
  const [hover, setHover] = useState<{ p: PartName; at: THREE.Vector3 } | null>(null);
  const pupil = useRef(1.6);
  return (
    <Stage className={className} camera={{ position: [34, 14, 40], fov: 34 }}>
      <Breath pupil={pupil} />
      <group rotation={[0, -0.25, 0]}>
        <EyeModel
          eye="OD"
          pupilRef={pupil}
          irisColor={irisColor}
          explode={explode}
          sectionX={section >= 12.9 ? null : section}
          highlight={hover?.p ?? null}
          onHover={(p, at) => setHover(p && at ? { p, at } : null)}
        />
      </group>
      {hover && (
        <Html position={hover.at.toArray()} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
          <div className="glass ml-4 -mt-4 w-[240px] rounded-[16px] px-3.5 py-2.5">
            <div className="text-[15px] font-semibold">{PART_INFO[hover.p].name}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-white/70">{PART_INFO[hover.p].line}</div>
          </div>
        </Html>
      )}
      <OrbitControls enablePan={false} minDistance={22} maxDistance={110} enableDamping />
    </Stage>
  );
}

function Breath({ pupil }: { pupil: React.MutableRefObject<number> }) {
  useFrame((s) => {
    pupil.current = 1.45 + 0.2 * Math.sin(s.clock.elapsedTime * 1.1);
  });
  return null;
}

// ------------------------------------------------------------------ DR stages (illustration)
export const STAGE_TEXT: Record<Grade, { title: string; body: string }> = {
  0: { title: "Grade 0 · No apparent retinopathy", body: "Vessels, disc and macula look normal. Rescreen in 12 months." },
  1: { title: "Grade 1 · Mild NPDR", body: "Microaneurysms only: tiny red dots where capillary walls bulge." },
  2: { title: "Grade 2 · Moderate NPDR", body: "More than microaneurysms: blot haemorrhages, hard exudates (leaked lipid), a few cotton-wool spots. Referable." },
  3: { title: "Grade 3 · Severe NPDR", body: "Many haemorrhages in all four quadrants, venous beading, more ischaemia. Refer urgently." },
  4: { title: "Grade 4 · Proliferative DR", body: "Fragile new vessels grow from the disc or elsewhere and can bleed into the vitreous. Refer immediately." },
};

export function StagesScene({ grade, className = "" }: { grade: Grade; className?: string }) {
  const tex = useMemo(() => {
    const a = analyse(4242 + grade * 101, { grade }, "OD", "macula", 45);
    const c = drawFundus({ ...a.art, nv: grade === 4 }, 1024);
    return { t: canvasTexture(c), lm: a.landmarks };
  }, [grade]);
  useEffect(() => () => tex.t.dispose(), [tex]);
  const proj = useMemo(() => makeProjection({ fovea: tex.lm.fovea, disc: tex.lm.od, fovDeg: 45 }), [tex]);
  return (
    <Stage className={className} camera={{ position: [0, 0, 3], fov: 70 }} bloom={0.3}>
      <LookAt target={[0, 0, -12]} />
      <EyeModel eye="OD" hideFront showVitreous={false} pupil={2} retina={{ fundus: tex.t, projection: proj, showUnimaged: false }} />
      <OrbitControls target={[0, 0, -4]} enablePan={false} rotateSpeed={-0.35} minDistance={2} maxDistance={8} minPolarAngle={Math.PI / 2 - 0.5} maxPolarAngle={Math.PI / 2 + 0.5} minAzimuthAngle={-0.5} maxAzimuthAngle={0.5} />
    </Stage>
  );
}

function LookAt({ target }: { target: V3 }) {
  const done = useRef(false);
  useFrame(({ camera }) => {
    if (done.current) return;
    camera.lookAt(...target);
    done.current = true;
  });
  return null;
}

// ------------------------------------------------------------------ coverage
const DEG = Math.PI / 180;
function rotToward(base: V3, dirXY: [number, number], ang: number): V3 {
  // rotate the posterior pole by `ang` toward the tangent direction (x, y) in world units
  const t = new THREE.Vector3(dirXY[0], dirXY[1], 0).normalize();
  const b = new THREE.Vector3(...base);
  return b.multiplyScalar(Math.cos(ang)).add(t.multiplyScalar(Math.sin(ang))).normalize().toArray() as V3;
}

export type CoverageKey = "one" | "two" | "four" | "uwf";
export function coverageFields(k: CoverageKey, eye: "OD" | "OS" = "OD"): { dirs: V3[]; half: number[]; label: string } {
  const nerve = nerveDirection(eye);
  const h = 22.5 * DEG;
  switch (k) {
    case "one": return { dirs: [POSTERIOR_POLE], half: [h], label: "1 field · 45° macula-centred" };
    case "two": return { dirs: [POSTERIOR_POLE, nerve], half: [h, h], label: "2 fields · macula + disc, 45° each" };
    case "four": return {
      dirs: [rotToward(POSTERIOR_POLE, [1, 1], 21 * DEG), rotToward(POSTERIOR_POLE, [-1, 1], 21 * DEG), rotToward(POSTERIOR_POLE, [1, -1], 21 * DEG), rotToward(POSTERIOR_POLE, [-1, -1], 21 * DEG)],
      half: [h, h, h, h], label: "4 fields · 45° each around the posterior pole",
    };
    case "uwf": return { dirs: [POSTERIOR_POLE], half: [100 * DEG], label: "Ultra-widefield · ~200°" };
  }
}

/** Share of the modelled retina (within 140° of the posterior pole) inside the fields. Fibonacci sampling. */
export function coverageShare(dirs: V3[], half: number[], n = 20000): number {
  let inRetina = 0, covered = 0;
  const g = Math.PI * (3 - Math.sqrt(5));
  const lim = Math.cos(140 * DEG);
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = g * i;
    const d: V3 = [Math.cos(th) * r, y, Math.sin(th) * r];
    const cp = -d[2]; // dot with (0,0,-1)
    if (cp < lim) continue;
    inRetina++;
    for (let k = 0; k < dirs.length; k++) {
      const c = d[0] * dirs[k][0] + d[1] * dirs[k][1] + d[2] * dirs[k][2];
      if (c >= Math.cos(half[k])) { covered++; break; }
    }
  }
  return covered / Math.max(1, inRetina);
}

export function CoverageScene({ k, className = "" }: { k: CoverageKey; className?: string }) {
  const f = useMemo(() => coverageFields(k), [k]);
  return (
    <Stage className={className} camera={{ position: [26, 18, -40], fov: 34 }} bloom={0.3}>
      <Spin />
      <EyeModel eye="OD" only={["retina"]} showVitreous={false} retina={{ caps: { dirs: f.dirs, half: f.half, color: "#64D2FF" } }} />
      <Html position={[0, 0, -14.5]} center><div className="pointer-events-none whitespace-nowrap rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/80">posterior pole</div></Html>
      <OrbitControls enablePan={false} minDistance={25} maxDistance={110} enableDamping />
    </Stage>
  );
}

function Spin() {
  useFrame(({ scene }, dt) => {
    scene.rotation.y += dt * 0.08;
  });
  return null;
}
