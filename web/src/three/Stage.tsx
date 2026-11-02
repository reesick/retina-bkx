import { Canvas, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useUI } from "../lib/store";

/** Procedural environment for reflections: a generated room, no HDRI download. */
function ProceduralEnv({ intensity = 0.6 }: { intensity?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

export function Lights() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[30, 40, 50]} intensity={2.2} />
      <directionalLight position={[-40, 10, -40]} intensity={1.2} color="#9fc4ff" />
      <pointLight position={[0, 0, -2]} intensity={30} distance={30} color="#ffb48a" />
    </>
  );
}

export function Stage({
  children, camera = { position: [0, 0, 60] as [number, number, number], fov: 32 }, className = "", bloom = 0.55, onCreated, effects = true,
}: {
  children: ReactNode; camera?: { position: [number, number, number]; fov?: number }; className?: string; bloom?: number;
  onCreated?: (s: { camera: THREE.Camera; gl: THREE.WebGLRenderer }) => void; effects?: boolean;
}) {
  const lowPower = useUI((s) => s.lowPower);
  const setLowPower = useUI((s) => s.setLowPower);
  const [dpr, setDpr] = useState(Math.min(2, window.devicePixelRatio || 1));
  return (
    <div className={/\b(absolute|fixed)\b/.test(className) ? className : `relative ${className}`}>
      <Canvas
        dpr={lowPower ? 1 : dpr}
        camera={{ position: camera.position, fov: camera.fov ?? 32, near: 0.1, far: 1000 }}
        gl={{ antialias: lowPower || !effects, alpha: true, powerPreference: "high-performance", stencil: false }}
        onCreated={(s) => {
          s.gl.localClippingEnabled = true;
          s.gl.setClearColor(0x000000, 1);
          s.gl.toneMapping = THREE.ACESFilmicToneMapping;
          onCreated?.({ camera: s.camera, gl: s.gl });
        }}
      >
        <PerformanceMonitor
          bounds={() => [45, 1000]}
          flipflops={2}
          onDecline={() => {
            setDpr(1);
            setLowPower(true);
          }}
        />
        <Suspense fallback={null}>
          <ProceduralEnv />
          <Lights />
          {children}
          {effects && !lowPower && (
            <EffectComposer multisampling={0} enableNormalPass={false}>
              <Bloom intensity={bloom} luminanceThreshold={0.75} luminanceSmoothing={0.2} mipmapBlur radius={0.55} />
              <Vignette eskil={false} offset={0.25} darkness={0.75} />
              <SMAA />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
}

/** Load a same-origin or data: URL into a texture without Suspense. */
export function useTexture(url: string | null | undefined, srgb = true): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (t) => {
        if (!alive) return t.dispose();
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        t.needsUpdate = true;
        setTex(t);
      },
      undefined,
      () => alive && setTex(null),
    );
    return () => {
      alive = false;
    };
  }, [url, srgb]);
  useEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

export function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
