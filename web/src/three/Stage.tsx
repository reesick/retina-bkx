import { Canvas, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useUI } from "../lib/store";
import { logWebGL } from "../lib/log";

const MAX_DPR = 1.5;
const ENV_SIZE = 64;

/** One low-resolution PMREM environment per renderer (rendered once, reused across scene switches). */
const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
function envFor(gl: THREE.WebGLRenderer): THREE.Texture {
  const hit = envCache.get(gl);
  if (hit) return hit;
  const room = new RoomEnvironment();
  const rt = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType });
  const cam = new THREE.CubeCamera(0.1, 100, rt);
  cam.update(gl, room);
  const pm = new THREE.PMREMGenerator(gl);
  const env = pm.fromCubemap(rt.texture).texture;
  pm.dispose();
  rt.dispose();
  (room as unknown as { dispose?: () => void }).dispose?.();
  envCache.set(gl, env);
  return env;
}

/** Procedural environment for reflections: a generated room, no HDRI download. */
function ProceduralEnv({ intensity = 0.6 }: { intensity?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    scene.environment = envFor(gl);
    return () => {
      scene.environment = null;
    };
  }, [gl, scene]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
  }, [scene, intensity]);
  useEffect(() => () => {
    envCache.get(gl)?.dispose();
    envCache.delete(gl);
  }, [gl]);
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

/** True while the element is on screen and the browser tab is visible. */
function useOnScreen(ref: React.RefObject<HTMLElement>): boolean {
  const [inView, setInView] = useState(true);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => setInView(es.some((e) => e.isIntersecting)), { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView && visible;
}

/**
 * The only way the app creates a WebGL canvas. Caps DPR, pauses rendering when hidden or off-screen, and recovers
 * from GPU context loss with an overlay + "Restore 3D" (remounts the Canvas) and one automatic retry.
 */
export function Stage({
  children, camera = { position: [0, 0, 60] as [number, number, number], fov: 32 }, className = "", bloom = 0.55, onCreated, effects = false,
}: {
  children: ReactNode; camera?: { position: [number, number, number]; fov?: number }; className?: string; bloom?: number;
  onCreated?: (s: { camera: THREE.Camera; gl: THREE.WebGLRenderer }) => void; effects?: boolean;
}) {
  const lowPower = useUI((s) => s.lowPower);
  const setLowPower = useUI((s) => s.setLowPower);
  const [dpr, setDpr] = useState(Math.min(MAX_DPR, window.devicePixelRatio || 1));
  const wrap = useRef<HTMLDivElement>(null);
  const active = useOnScreen(wrap);
  const [gen, setGen] = useState(0);
  const [lost, setLost] = useState(false);
  const autoRetried = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const restore = useCallback((why: "restored" | "restore-click") => {
    logWebGL(why);
    setLost(false);
    setGen((g) => g + 1);
  }, []);

  const watch = useCallback((canvas: HTMLCanvasElement) => {
    const onLost = (e: Event) => {
      e.preventDefault(); // allow the browser to restore the context
      // R3F force-loses the context when a canvas unmounts; only a loss on a live canvas is a crash
      if (!mounted.current || !canvas.isConnected) return;
      logWebGL("lost", { route: location.pathname });
      // unmount the Canvas at once: re-rendering post-processing on a lost context throws
      setLost(true);
    };
    const onRestored = () => {
      // the GPU came back: remount once automatically (the lost canvas itself is already unmounted)
      if (!mounted.current) return;
      if (!autoRetried.current) {
        autoRetried.current = true;
        restore("restored");
      }
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
  }, [restore]);

  const post = effects && !lowPower;
  return (
    <div ref={wrap} className={/\b(absolute|fixed)\b/.test(className) ? className : `relative ${className}`}>
      {!lost && <Canvas
        key={gen}
        dpr={lowPower ? 1 : dpr}
        frameloop={active ? "always" : "never"}
        camera={{ position: camera.position, fov: camera.fov ?? 32, near: 0.1, far: 1000 }}
        gl={{ antialias: !post, alpha: true, powerPreference: "high-performance", stencil: false }}
        onCreated={(s) => {
          s.gl.localClippingEnabled = true;
          s.gl.setClearColor(0x000000, 1);
          s.gl.toneMapping = THREE.ACESFilmicToneMapping;
          watch(s.gl.domElement);
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
          {post && (
            <EffectComposer multisampling={0} enableNormalPass={false}>
              <Bloom intensity={bloom} luminanceThreshold={0.75} luminanceSmoothing={0.2} mipmapBlur radius={0.55} />
              <Vignette eskil={false} offset={0.25} darkness={0.75} />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>}
      {lost && (
        <div role="alert" className="absolute inset-0 z-20 grid place-items-center bg-black/80 p-6 text-center">
          <div className="max-w-[320px]">
            <div className="text-headline">3D paused.</div>
            <p className="mt-1 text-[14px] text-l2">The graphics card reset the 3D view. The rest of the page still works.</p>
            <button type="button" className="btn-white mt-4" onClick={() => restore("restore-click")}>Restore 3D</button>
          </div>
        </div>
      )}
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
