// Eye Lab · Optics: live meridional ray tracing through the Le Grand schematic eye (src/lib/optics.ts).
import { Html, Line, OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { buildEye, traceFan, type EyeModel as OpticEye, type Surface, type ThinLens } from "../lib/optics";
import { Stage } from "./Stage";

/** Optical axis x (mm from the corneal apex) -> world X centred on the globe. */
const OX = -12;
const P = (x: number, y: number): [number, number, number] => [x + OX, y, 0];

function surfacePts(s: { x: number; R: number }, semi: number, n = 48): [number, number, number][] {
  const out: [number, number, number][] = [];
  const c = s.x + s.R;
  const sg = Math.sign(s.R);
  for (let i = 0; i <= n; i++) {
    const y = -semi + (2 * semi * i) / n;
    const x = c - sg * Math.sqrt(Math.max(0, s.R * s.R - y * y));
    out.push(P(x, y));
  }
  return out;
}

function Fill({ a, b, semi, color, opacity }: { a: Surface; b: Surface; semi: number; color: string; opacity: number }) {
  const geom = useMemo(() => {
    const A = surfacePts(a, semi), B = surfacePts(b, semi).reverse();
    const shape = new THREE.Shape(A.map(([x, y]) => new THREE.Vector2(x, y)));
    B.forEach(([x, y]) => shape.lineTo(x, y));
    shape.closePath();
    return new THREE.ShapeGeometry(shape, 1);
  }, [a, b, semi]);
  return (
    <mesh geometry={geom} position={[0, 0, -0.05]}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Scene({ eye, objectDist, lens, nRays }: { eye: OpticEye; objectDist: number; lens: ThinLens | null; nRays: number }) {
  const fan = useMemo(() => traceFan(eye, objectDist, nRays, lens), [eye, objectDist, lens, nRays]);
  const [s1, s2, s3, s4] = eye.surfaces;
  const L = eye.retina.x;
  const retinaArc = useMemo(() => {
    const pts: [number, number, number][] = [];
    const c = L + eye.retina.R; // centre of the retina sphere
    for (let i = 0; i <= 96; i++) {
      const a = (-130 + (260 * i) / 96) * (Math.PI / 180);
      pts.push(P(c + Math.abs(eye.retina.R) * Math.cos(a), Math.abs(eye.retina.R) * Math.sin(a)));
    }
    return pts;
  }, [L, eye.retina.R]);
  const fx = fan.focusX;
  const startX = Number.isFinite(objectDist) ? Math.max(-objectDist, -40) : -34;
  return (
    <group>
      {/* globe outline: retina arc */}
      <Line points={retinaArc} color="#FF6B4A" lineWidth={2.2} transparent opacity={0.9} />
      <Html position={P(L + 0.8, 7.5)} center><div className="pointer-events-none whitespace-nowrap text-[11px] text-[#FF8A6A]">Retina</div></Html>
      {/* cornea & lens */}
      <Fill a={s1} b={s2} semi={5.6} color="#9fd8ff" opacity={0.16} />
      <Fill a={s3} b={s4} semi={4.4} color="#fff2cf" opacity={0.2} />
      <Line points={surfacePts(s1, 5.8)} color="#9fd8ff" lineWidth={1.6} />
      <Line points={surfacePts(s2, 5.5)} color="#9fd8ff" lineWidth={1} transparent opacity={0.6} />
      <Line points={surfacePts(s3, 4.4)} color="#ffe7a0" lineWidth={1.6} />
      <Line points={surfacePts(s4, 4.4)} color="#ffe7a0" lineWidth={1.6} />
      {/* iris */}
      <Line points={[P(eye.stopX, eye.pupil / 2), P(eye.stopX, 5.8)]} color="#8a5a34" lineWidth={5} />
      <Line points={[P(eye.stopX, -eye.pupil / 2), P(eye.stopX, -5.8)]} color="#8a5a34" lineWidth={5} />
      {/* axis */}
      <Line points={[P(startX - 4, 0), P(L + 2, 0)]} color="#ffffff" lineWidth={0.6} transparent opacity={0.18} dashed dashSize={0.6} gapSize={0.6} />
      {/* corrective lens */}
      {lens && (
        <group>
          <Line points={[P(lens.x, -7), P(lens.x, 7)]} color={lens.power < 0 ? "#64D2FF" : "#30D158"} lineWidth={4} />
          <Html position={P(lens.x, 8.6)} center><div className="pointer-events-none whitespace-nowrap rounded-full bg-black/70 px-2 py-0.5 text-[11px]">{lens.power > 0 ? "+" : ""}{lens.power.toFixed(2)} D</div></Html>
        </group>
      )}
      {/* object */}
      {Number.isFinite(objectDist) && objectDist <= 40 && <mesh position={P(-objectDist, 0)}><sphereGeometry args={[0.35, 16, 16]} /><meshBasicMaterial color="#fff" /></mesh>}
      {/* rays */}
      {fan.rays.map((r, i) => {
        const pts = r.points.map((p) => (p.x < startX ? { x: startX, y: p.y + ((startX - p.x) / ((r.points[1]?.x ?? startX) - p.x || 1)) * ((r.points[1]?.y ?? p.y) - p.y) } : p));
        return <Line key={i} points={pts.map((p) => P(p.x, p.y))} color={r.blocked ? "#555" : "#FFF3D6"} lineWidth={r.blocked ? 0.8 : 1.6} transparent opacity={r.blocked ? 0.35 : 0.95} />;
      })}
      {/* focus */}
      {Number.isFinite(fx) && Math.abs(fx - L) < 12 && (
        <group>
          <mesh position={P(fx, 0)}><sphereGeometry args={[0.28, 16, 16]} /><meshBasicMaterial color="#FFD60A" toneMapped={false} /></mesh>
          <Html position={P(fx, -1.6)} center><div className="pointer-events-none whitespace-nowrap text-[11px] text-review">focus</div></Html>
        </group>
      )}
      <Html position={P(-2, -8.2)} center><div className="pointer-events-none whitespace-nowrap text-[11px] text-white/50">Cornea</div></Html>
      <Html position={P(eye.stopX + 2, -6.4)} center><div className="pointer-events-none whitespace-nowrap text-[11px] text-white/50">Lens</div></Html>
    </group>
  );
}

export default function OpticsView({ axial, accommodation, pupil, objectDist, lensPower, nRays = 15, className = "" }: { axial: number; accommodation: number; pupil: number; objectDist: number; lensPower: number | null; nRays?: number; className?: string }) {
  const eye = useMemo(() => buildEye({ axialLength: axial, accommodation, pupil }), [axial, accommodation, pupil]);
  const lens = useMemo<ThinLens | null>(() => (lensPower != null ? { x: -12, power: lensPower } : null), [lensPower]);
  return (
    <Stage className={className} camera={{ position: [-4, 0, 52], fov: 38 }} bloom={0.9}>
      <Scene eye={eye} objectDist={objectDist} lens={lens} nRays={nRays} />
      <OrbitControls enablePan={false} target={[-4, 0, 0]} minDistance={22} maxDistance={90} minAzimuthAngle={-0.5} maxAzimuthAngle={0.5} minPolarAngle={Math.PI / 2 - 0.4} maxPolarAngle={Math.PI / 2 + 0.4} />
    </Stage>
  );
}
