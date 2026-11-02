// Today's living eye: breathes, follows the cursor, blinks (pupil constrict + iris shimmer), click to fly in.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EyeModel, IRIS_COLORS } from "./EyeModel";
import { Stage } from "./Stage";
import { useReducedMotion } from "../lib/store";
import { sound } from "../lib/sound";

function Living({ onActivate, flying }: { onActivate: () => void; flying: boolean }) {
  const g = useRef<THREE.Group>(null);
  const pupil = useRef(1.4);
  const shimmer = useRef(0);
  const target = useRef({ x: 0, y: 0 });
  const vel = useRef({ x: 0, y: 0 });
  const nextBlink = useRef(6 + Math.random() * 4);
  const blinkAt = useRef(-10);
  const [hover, setHover] = useState(false);
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
    // spring toward the gaze target (stiffness 60, damping 12)
    const grp = g.current;
    if (grp) {
      const k = 60, c = 12;
      for (const ax of ["x", "y"] as const) {
        const cur = ax === "x" ? grp.rotation.y : grp.rotation.x;
        const tgt = reduced ? 0 : ax === "x" ? target.current.x : target.current.y;
        vel.current[ax] += (k * (tgt - cur) - c * vel.current[ax]) * d;
        const nv = cur + vel.current[ax] * d;
        if (ax === "x") grp.rotation.y = nv;
        else grp.rotation.x = nv;
      }
      grp.position.y = reduced ? 0 : Math.sin(t * 0.6) * 0.4;
      const sc = hover ? 1.04 : 1;
      grp.scale.lerp(new THREE.Vector3(sc, sc, sc), 0.12);
    }
    // breathing pupil 2.5 <-> 3.2 mm (radius 1.25 <-> 1.6)
    let pr = 1.425 + 0.175 * Math.sin((t * Math.PI * 2) / 5.5);
    if (!reduced && t > nextBlink.current) {
      blinkAt.current = t;
      nextBlink.current = t + 6 + Math.random() * 4;
    }
    const b = t - blinkAt.current;
    if (b >= 0 && b < 0.5) {
      const k = Math.sin((b / 0.5) * Math.PI);
      pr = pr * (1 - 0.45 * k);
      shimmer.current = k;
    } else shimmer.current = 0;
    pupil.current = pr;
    if (flying) {
      camera.position.lerp(new THREE.Vector3(0, 0, 16), 0.08);
      camera.lookAt(0, 0, 0);
    }
  });

  return (
    <group
      ref={g}
      onPointerOver={() => {
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        e.stopPropagation();
        sound.tick();
        onActivate();
      }}
    >
      <EyeModel eye="OD" pupilRef={pupil} shimmerRef={shimmer} irisColor={IRIS_COLORS.brown} showVitreous={false} />
    </group>
  );
}

export default function LivingEye({ onActivate, className = "" }: { onActivate: () => void; className?: string }) {
  const [flying, setFlying] = useState(false);
  useEffect(() => () => {
    document.body.style.cursor = "";
  }, []);
  return (
    <Stage className={className} camera={{ position: [0, 0, 74], fov: 30 }} bloom={0.4}>
      <Living
        flying={flying}
        onActivate={() => {
          setFlying(true);
          setTimeout(onActivate, 650);
        }}
      />
    </Stage>
  );
}
