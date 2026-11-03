// Today's living eye: breathes, follows the cursor, blinks (pupil constrict + iris shimmer).
// Hover: scales up on a spring, rim glow brightens, gaze snaps to the cursor, tooltip near the cursor.
// Click: short eased fly-in (450 ms), then navigate.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EyeModel, IRIS_COLORS, type PartName } from "./EyeModel";
import { Stage } from "./Stage";
import { useReducedMotion } from "../lib/store";
import { sound } from "../lib/sound";

const FLY_MS = 450;
// Only the parts visible from the front: skips compiling the retina, lens and posterior shaders (faster start).
const TODAY_PARTS: PartName[] = ["sclera", "iris", "pupil", "cornea"];
const CAM_Z = 74;
const FLY_Z = 44;

function RimGlow({ strength }: { strength: React.MutableRefObject<number> }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uStrength: { value: 0.25 }, uColor: { value: new THREE.Color("#cfe4ff") } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uStrength; uniform vec3 uColor;
          varying vec3 vN; varying vec3 vV;
          void main() {
            float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
            gl_FragColor = vec4(uColor * f * uStrength, f * uStrength);
          }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    mat.uniforms.uStrength.value = strength.current;
  });
  return (
    <mesh material={mat} raycast={() => null}>
      <sphereGeometry args={[12.35, 48, 32]} />
    </mesh>
  );
}

function Living({ hovered, flyAt }: { hovered: boolean; flyAt: number | null }) {
  const g = useRef<THREE.Group>(null);
  const pupil = useRef(1.4);
  const shimmer = useRef(0);
  const target = useRef({ x: 0, y: 0 });
  const vel = useRef({ x: 0, y: 0 });
  const scaleV = useRef(0);
  const glow = useRef(0.25);
  const nextBlink = useRef(6 + Math.random() * 4);
  const blinkAt = useRef(-10);
  const hover = useRef(hovered);
  hover.current = hovered;
  const reduced = useReducedMotion();
  const { camera } = useThree();

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      // the eye sits on the right half; aim from its own centre
      const max = (25 * Math.PI) / 180;
      target.current = { x: Math.max(-max, Math.min(max, (nx - 0.45) * 0.7)), y: Math.max(-max, Math.min(max, ny * 0.55)) };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const d = Math.min(dt, 0.05);
    const grp = g.current;
    const h = hover.current;
    if (grp) {
      // spring toward the gaze target; stiffer on hover so the eye snaps to the cursor
      const k = h ? 160 : 60, c = h ? 22 : 12;
      for (const ax of ["x", "y"] as const) {
        const cur = ax === "x" ? grp.rotation.y : grp.rotation.x;
        const tgt = reduced ? 0 : ax === "x" ? target.current.x : target.current.y;
        vel.current[ax] += (k * (tgt - cur) - c * vel.current[ax]) * d;
        const nv = cur + vel.current[ax] * d;
        if (ax === "x") grp.rotation.y = nv;
        else grp.rotation.x = nv;
      }
      grp.position.y = reduced ? 0 : Math.sin(t * 0.6) * 0.4;
      // scale spring (stiffness 220, damping 16)
      const sc = grp.scale.x;
      const st = h && !reduced ? 1.08 : 1;
      scaleV.current += (220 * (st - sc) - 16 * scaleV.current) * d;
      grp.scale.setScalar(sc + scaleV.current * d);
    }
    glow.current += ((h ? 1.1 : 0.25) - glow.current) * Math.min(1, d * 8);
    // breathing pupil 2.5 <-> 3.2 mm (radius 1.25 <-> 1.6)
    let pr = 1.425 + 0.175 * Math.sin((t * Math.PI * 2) / 5.5);
    if (!reduced && t > nextBlink.current) {
      blinkAt.current = t;
      nextBlink.current = t + 6 + Math.random() * 4;
    }
    const b = t - blinkAt.current;
    if (b >= 0 && b < 0.5) {
      const kk = Math.sin((b / 0.5) * Math.PI);
      pr = pr * (1 - 0.45 * kk);
      shimmer.current = kk;
    } else shimmer.current = 0;
    if (h) pr *= 0.85;
    pupil.current = pr;
    if (flyAt != null) {
      const p = Math.min(1, (performance.now() - flyAt) / FLY_MS);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
      camera.position.set(0, 0, CAM_Z + (FLY_Z - CAM_Z) * e);
      camera.lookAt(0, 0, 0);
    }
  });

  return (
    <group ref={g}>
      <EyeModel eye="OD" pupilRef={pupil} shimmerRef={shimmer} irisColor={IRIS_COLORS.brown} showVitreous={false} only={TODAY_PARTS} />
      <RimGlow strength={glow} />
    </group>
  );
}

/** Screen-space hit test against the eye's projected disc (radius 12 mm at 74 mm, fov 30°): deterministic hover. */
function overEye(e: React.PointerEvent | React.MouseEvent): { inside: boolean; x: number; y: number } {
  const r = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const R = (12.4 / (CAM_Z * Math.tan((15 * Math.PI) / 180))) * (r.height / 2);
  return { inside: Math.hypot(x - r.width / 2, y - r.height / 2) <= R, x, y };
}

export default function LivingEye({ onActivate, className = "" }: { onActivate: () => void; className?: string }) {
  const [flyAt, setFlyAt] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  return (
    <div
      className={className}
      style={{ cursor: hover ? "pointer" : "default" }}
      onPointerMove={(e) => {
        const h = overEye(e);
        setTip({ x: h.x, y: h.y });
        if (h.inside !== hover) setHover(h.inside);
      }}
      onPointerLeave={() => setHover(false)}
      onClick={(e) => {
        if (!overEye(e).inside || flyAt != null) return;
        sound.tick();
        setFlyAt(performance.now());
        timer.current = window.setTimeout(onActivate, FLY_MS + 30);
      }}
    >
      <Stage className="absolute inset-0" camera={{ position: [0, 0, CAM_Z], fov: 30 }} bloom={0.4}>
        <Living flyAt={flyAt} hovered={hover} />
      </Stage>
      <div
        aria-hidden
        className="glass pointer-events-none absolute z-10 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium text-white transition-opacity duration-200"
        style={{ left: (tip?.x ?? 0) + 18, top: (tip?.y ?? 0) + 18, opacity: hover && flyAt == null ? 1 : 0 }}
      >
        Open the Eye Lab
      </div>
    </div>
  );
}
