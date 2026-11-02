import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitImpl } from "three-stdlib";

export interface Shot { path: [number, number, number][]; look: [number, number, number]; duration: number }

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Flies the camera along a Catmull-Rom path, blending the look-at target; hands control back to OrbitControls. */
export function CameraRig({ shot, controls, onDone, reduced }: { shot: Shot | null; controls: React.RefObject<OrbitImpl>; onDone?: () => void; reduced?: boolean }) {
  const { camera } = useThree();
  const st = useRef<{ curve: THREE.CatmullRomCurve3; from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number } | null>(null);
  useEffect(() => {
    if (!shot) return;
    const pts = [camera.position.clone(), ...shot.path.map((p) => new THREE.Vector3(...p))];
    const from = controls.current ? controls.current.target.clone() : new THREE.Vector3();
    const to = new THREE.Vector3(...shot.look);
    if (reduced) {
      camera.position.copy(pts[pts.length - 1]);
      camera.lookAt(to);
      if (controls.current) {
        controls.current.target.copy(to);
        controls.current.update();
      }
      onDone?.();
      return;
    }
    st.current = { curve: new THREE.CatmullRomCurve3(pts, false, "centripetal"), from, to, t0: -1, dur: shot.duration };
    if (controls.current) controls.current.enabled = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot]);
  useFrame((s) => {
    const a = st.current;
    if (!a) return;
    if (a.t0 < 0) a.t0 = s.clock.elapsedTime;
    const t = Math.min(1, (s.clock.elapsedTime - a.t0) / a.dur);
    const k = ease(t);
    camera.position.copy(a.curve.getPoint(k));
    const look = a.from.clone().lerp(a.to, k);
    camera.lookAt(look);
    if (controls.current) controls.current.target.copy(look);
    if (t >= 1) {
      st.current = null;
      if (controls.current) {
        controls.current.enabled = true;
        controls.current.update();
      }
      onDone?.();
    }
  });
  return null;
}
