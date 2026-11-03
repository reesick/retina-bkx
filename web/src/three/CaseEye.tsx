// 3D eye on the case page: fundus + overlays projected onto a generic retina, fly-through, section, explode.
import { Html, OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import * as THREE from "three";
import { motion } from "framer-motion";
import type { ImageResult, Lesion } from "../api/types";
import { assetUrl } from "../api/client";
import { EyeModel } from "./EyeModel";
import { CameraRig, type Shot } from "./CameraRig";
import { Stage, useTexture } from "./Stage";
import { angleDeg, imageToSphere, makeProjection, nerveDirection, sphereToImage, type V3 } from "./projection";
import { LESION_COLOR, LESION_NAME } from "../lib/format";
import { useReducedMotion, useSettings } from "../lib/store";
import { Segmented } from "../components/Segmented";
import { RotateCcw } from "lucide-react";

export interface LayerState { cam: number; att: number; les: number }

const INSIDE: Shot = { path: [[0, 2, 34], [0, 0, 16], [0, 0, 9.5], [0, 0, 2.2]], look: [0, 0, -11], duration: 1.6 };
const OUTSIDE: Shot = { path: [[0, 0, 9.5], [6, 3, 26], [22, 9, 44]], look: [0, 0, 0], duration: 1.4 };

export default function CaseEye({
  image, layers, selected, onSelect, className = "",
}: { image: ImageResult; layers: LayerState; selected: Lesion | null; onSelect: (id: string | null) => void; className?: string }) {
  const showUnimaged = useSettings((s) => s.showUnimaged);
  const reduced = useReducedMotion();
  const fundus = useTexture(assetUrl(image.urls.canonical));
  const cam = useTexture(assetUrl(image.urls.overlays.cam) || null);
  const att = useTexture(assetUrl(image.urls.overlays.attention) || null);
  const les = useTexture(assetUrl(image.urls.overlays.lesions) || null);
  const lm = image.landmarks;
  const proj = useMemo(
    () => makeProjection({ fovea: lm ? { x: lm.fovea.x, y: lm.fovea.y } : { x: 0.5, y: 0.5 }, disc: lm ? { x: lm.od.x, y: lm.od.y } : null, fovDeg: image.fov_deg || 45 }),
    [lm, image.fov_deg],
  );
  const discErr = lm ? angleDeg(imageToSphere(proj, lm.od.x, lm.od.y), nerveDirection(image.eye)) : null;
  const [mode, setMode] = useState<"inside" | "outside">("inside");
  const [shot, setShot] = useState<Shot | null>(INSIDE);
  const [section, setSection] = useState(false);
  const [explode, setExplode] = useState(false);
  const controls = useRef<OrbitImpl>(null);
  const [flying, setFlying] = useState(true);

  const selDir = selected ? imageToSphere(proj, selected.centroid[0], selected.centroid[1]) : null;
  // label for the un-imaged retina: just outside the field, superior-temporal
  const unimagedDir = useMemo<V3>(() => {
    const k = (proj.halfFov + 0.32) / proj.halfFov;
    const qx = 0.5 + (image.eye === "OD" ? -0.35 : 0.35) * k, qy = 0.5 - 0.35 * k;
    return imageToSphere(proj, qx, qy);
  }, [proj, image.eye]);

  const go = (m: "inside" | "outside") => {
    setMode(m);
    setFlying(true);
    setShot({ ...(m === "inside" ? INSIDE : OUTSIDE) });
    if (m === "inside") { setSection(false); setExplode(false); }
  };

  const pick = (dir: V3) => {
    const q = sphereToImage(proj, dir);
    if (!q.inside || !image.lesions) return onSelect(null);
    let best: Lesion | null = null, bd = 0.045;
    for (const l of image.lesions.items) {
      const d = Math.hypot(l.centroid[0] - q.x, l.centroid[1] - q.y) - Math.max(l.bbox[2], l.bbox[3]) / 2;
      if (d < bd) { bd = d; best = l; }
    }
    onSelect(best?.id ?? null);
  };

  const [explodeV, setExplodeV] = useState(0);
  const ex = useRef(0);

  return (
    <div className={`relative overflow-hidden rounded-card bg-black ${className}`}>
      <Stage className="absolute inset-0" camera={{ position: [24, 10, 48], fov: 42 }} bloom={0.35} effects>
        <ExplodeDriver target={explode ? 0.8 : 0} value={ex} onChange={setExplodeV} />
        <EyeModel
          eye={image.eye}
          pupil={2.6}
          explode={explodeV}
          sectionX={section ? 0 : null}
          showVitreous={mode === "outside"}
          retina={{ fundus, cam, att, les, camOn: layers.cam, attOn: layers.att, lesOn: layers.les, projection: proj, showUnimaged, selected: selDir }}
          onRetinaClick={(d) => pick(d)}
        />
        {selected && selDir && (
          <Html position={new THREE.Vector3(...selDir).multiplyScalar(11.6 - 3 * explodeV).toArray()} center zIndexRange={[20, 0]}>
            <div className="pointer-events-none -translate-y-7 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold text-black" style={{ background: LESION_COLOR[selected.type] }}>
              {LESION_NAME[selected.type]} · {(selected.confidence * 100).toFixed(0)}%
            </div>
          </Html>
        )}
        {showUnimaged && mode === "inside" && !flying && (
          <Html position={new THREE.Vector3(...unimagedDir).multiplyScalar(11.5).toArray()} center zIndexRange={[10, 0]}>
            <div className="pointer-events-none whitespace-nowrap rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/70">Not imaged</div>
          </Html>
        )}
        <OrbitControls
          ref={controls}
          makeDefault
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={mode === "inside" ? -0.35 : 0.6}
          minDistance={mode === "inside" ? 0.5 : 18}
          maxDistance={mode === "inside" ? 9 : 110}
          minPolarAngle={mode === "inside" ? Math.PI / 2 - 0.6 : 0.05}
          maxPolarAngle={mode === "inside" ? Math.PI / 2 + 0.6 : Math.PI - 0.05}
          minAzimuthAngle={mode === "inside" ? -0.6 : -Infinity}
          maxAzimuthAngle={mode === "inside" ? 0.6 : Infinity}
        />
        <CameraRig shot={shot} controls={controls} reduced={reduced} onDone={() => { setFlying(false); setShot(null); }} />
      </Stage>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-3">
        <div className="pointer-events-auto glass rounded-[12px] p-0.5">
          <Segmented size="sm" ariaLabel="Camera" value={mode} onChange={go} options={[{ value: "inside", label: "Inside" }, { value: "outside", label: "Outside" }]} />
        </div>
        <button type="button" className={`pointer-events-auto chip glass ${section ? "!bg-white !text-black" : ""}`} aria-pressed={section} onClick={() => { if (mode === "inside") go("outside"); setSection((s) => !s); }}>
          Cross-section
        </button>
        <button type="button" className={`pointer-events-auto chip glass ${explode ? "!bg-white !text-black" : ""}`} aria-pressed={explode} onClick={() => { if (mode === "inside") go("outside"); setExplode((s) => !s); }}>
          Layers
        </button>
        <button type="button" className="pointer-events-auto chip glass" onClick={() => { setSection(false); setExplode(false); go("inside"); }} aria-label="Reset view">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-3 pt-10 text-[12px] leading-snug text-l2">
        Approximate projection onto a generic eye. Not a scan of this patient.
        {proj.scaled && <> Field scaled to disc–fovea distance (15.5°; measured {proj.discFoveaDegRaw.toFixed(1)}°).</>}
        {discErr != null && <> Disc lands {discErr.toFixed(1)}° from the model nerve head.</>} Click the retina to select a lesion candidate.
      </motion.div>
    </div>
  );
}

function ExplodeDriver({ target, value, onChange }: { target: number; value: React.MutableRefObject<number>; onChange: (v: number) => void }) {
  useFrame((_, dt) => {
    const v = value.current;
    if (Math.abs(v - target) < 0.001) return;
    const n = v + (target - v) * Math.min(1, dt * 6);
    value.current = Math.abs(n - target) < 0.002 ? target : n;
    onChange(value.current);
  });
  return null;
}
