import { Canvas, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useUI } from "../lib/store";
import { logWebGL } from "../lib/log";
import type { EnvReply } from "./envWorker";

const MAX_DPR = 1.5;
const ENV_SIZE = 64;
const mark = (name: string, start: number) => {
  try {
    performance.measure(name, { start, end: performance.now() });
  } catch { /* old browsers */ }
};

// ------------------------------------------------------------------ reflection environment
// A generated room (no HDRI download) blurred by PMREM. On hardware GPUs it is built in a worker on an
// OffscreenCanvas, so its shader compiles and blur passes stay off the main thread, and the texels are uploaded as a
// cube-UV DataTexture. With software rendering (SwiftShader) the worker would compete with the page for the same
// GPU process, so it is built on the main thread (also the fallback when workers / OffscreenCanvas fail).
let envData: Promise<Extract<EnvReply, { ok: true }> | null> | null = null;
function envFromWorker(): Promise<Extract<EnvReply, { ok: true }> | null> {
  if (envData) return envData;
  envData = new Promise((resolve) => {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || /[?&]noenvworker\b/.test(location.search)) return resolve(null);
    let w: Worker;
    try {
      w = new Worker(new URL("./envWorker.ts", import.meta.url), { type: "module" });
    } catch {
      return resolve(null);
    }
    const t0 = performance.now();
    const timer = setTimeout(() => { w.terminate(); resolve(null); }, 6000);
    w.onmessage = (e: MessageEvent<EnvReply>) => {
      clearTimeout(timer);
      w.terminate();
      mark("3d:env-worker", t0);
      resolve(e.data.ok ? e.data : null);
    };
    w.onerror = () => { clearTimeout(timer); w.terminate(); resolve(null); };
    w.postMessage({ size: ENV_SIZE });
  });
  // a failed attempt is retried by the next canvas
  void envData.then((d) => { if (!d) envData = null; });
  return envData;
}

function envOnMainThread(gl: THREE.WebGLRenderer): THREE.Texture {
  const t0 = performance.now();
  const room = new RoomEnvironment();
  const rt = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType });
  new THREE.CubeCamera(0.1, 100, rt).update(gl, room);
  const pm = new THREE.PMREMGenerator(gl);
  const env = pm.fromCubemap(rt.texture).texture;
  pm.dispose();
  rt.dispose();
  (room as unknown as { dispose?: () => void }).dispose?.();
  mark("3d:env-main", t0);
  return env;
}

const envPending = new WeakMap<THREE.WebGLRenderer, Promise<THREE.Texture>>();
function envAsync(gl: THREE.WebGLRenderer): Promise<THREE.Texture> {
  let p = envPending.get(gl);
  if (!p) {
    p = (hasParallel(gl) ? envFromWorker() : Promise.resolve(null)).then((d) => {
      if (!d) return envOnMainThread(gl);
      const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, THREE.HalfFloatType);
      t.mapping = THREE.CubeUVReflectionMapping;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.colorSpace = d.colorSpace as THREE.ColorSpace;
      t.needsUpdate = true;
      return t;
    });
    envPending.set(gl, p);
  }
  return p;
}
const envReady = (gl: THREE.WebGLRenderer) => envAsync(gl).then(() => undefined, () => undefined);

// ------------------------------------------------------------------ non-blocking shader compilation
// Linking a WebGL program takes 30–350 ms per material variant on D3D11. three waits for the link on first use,
// inside a frame, which blocks the main thread. With KHR_parallel_shader_compile the content stays hidden while
// every program variant it will need is compiled in small chunks; completion is polled without blocking.
const hasParallel = (gl: THREE.WebGLRenderer) =>
  gl.extensions.has("KHR_parallel_shader_compile") && !(typeof location !== "undefined" && /[?&]nogate\b/.test(location.search));
/** Whether a Stage renders through the post-processing composer (scene draws go to a render target only). */
const POST = new WeakMap<THREE.WebGLRenderer, boolean>();

interface Primers { plain: THREE.Scene; clip: Map<number, THREE.Scene>; rt: THREE.WebGLRenderTarget; geo: THREE.BufferGeometry }
const primers = new WeakMap<THREE.WebGLRenderer, Primers>();
function primerScene(geo: THREE.BufferGeometry, planes: number): THREE.Scene {
  const s = new THREE.Scene();
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
  if (planes) m.clippingPlanes = Array.from({ length: planes }, () => new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e9));
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  s.add(mesh);
  return s;
}
function primersFor(gl: THREE.WebGLRenderer): Primers {
  let p = primers.get(gl);
  if (!p) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1e-4, 0, 0, 0, 1e-4, 0], 3));
    p = { geo, plain: primerScene(geo, 0), clip: new Map(), rt: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }) };
    primers.set(gl, p);
  }
  return p;
}
const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Compile the programs `root` will need, then wait until they are linked. three keys a program by the clipping
 * plane count current when it is built and by whether it renders to the screen or to a render target, so an
 * invisible one-triangle "primer" draw sets the clipping state and the matching target is bound for each batch.
 */
export async function warmUp(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D, isAlive: () => boolean): Promise<void> {
  if (!hasParallel(gl)) return; // nothing to gain: three would block anyway
  const p = primersFor(gl);
  const post = POST.get(gl) ?? false;
  type Job = { o: THREE.Object3D; planes: number; rt: boolean };
  const jobs: Job[] = [];
  root.traverse((o) => {
    const r = o as THREE.Mesh;
    if (!(r.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) || !r.material) return;
    const ms = Array.isArray(r.material) ? r.material : [r.material];
    const planes = gl.localClippingEnabled ? Math.max(0, ...ms.map((m) => m.clippingPlanes?.length ?? 0)) : 0;
    // with post-processing every scene draw goes to the composer's target; without it, opaque objects are also
    // drawn into the transmission target when the scene has glass (cornea, lens)
    if (!post) jobs.push({ o, planes, rt: false });
    jobs.push({ o, planes, rt: true });
  });
  jobs.sort((a, b) => a.planes - b.planes || Number(a.rt) - Number(b.rt));
  const primer = (n: number) => {
    if (!n) return p.plain;
    let s = p.clip.get(n);
    if (!s) p.clip.set(n, (s = primerScene(p.geo, n)));
    return s;
  };
  const mats = new Set<THREE.Material>();
  const t0 = performance.now();
  let i = 0;
  while (i < jobs.length) {
    if (!isAlive()) return;
    const prevRT = gl.getRenderTarget();
    const prevClear = gl.autoClear;
    gl.autoClear = false;
    const tc = performance.now();
    let cur = "";
    try {
      while (i < jobs.length && performance.now() - tc < 24) {
        const j = jobs[i++];
        const key = `${j.planes}|${j.rt}`;
        if (key !== cur) {
          gl.setRenderTarget(null);
          gl.render(primer(j.planes), camera);
          gl.setRenderTarget(j.rt ? p.rt : null);
          cur = key;
        }
        gl.compile(j.o, camera, scene).forEach((m) => mats.add(m));
      }
    } finally {
      gl.setRenderTarget(prevRT);
      gl.autoClear = prevClear;
    }
    await yieldTask();
  }
  mark("3d:compile-submit", t0);
  const props = gl.properties as unknown as { get: (m: THREE.Material) => { programs?: Map<string, { isReady: () => boolean }> } };
  await new Promise<void>((resolve) => {
    const check = () => {
      if (!isAlive() || performance.now() - t0 > 10000) return resolve();
      for (const m of mats) {
        const progs = props.get(m).programs;
        if (!progs || [...progs.values()].every((pr) => pr.isReady())) mats.delete(m);
      }
      if (!mats.size) resolve();
      else setTimeout(check, 16);
    };
    check();
  });
}

/** Link the two primer programs once, before the parallel queue fills up (otherwise they wait behind it). */
function PrimeOnce() {
  const { gl, camera } = useThree();
  useEffect(() => {
    if (!hasParallel(gl)) return;
    const p = primersFor(gl);
    const prevClear = gl.autoClear;
    gl.autoClear = false;
    gl.setRenderTarget(null);
    gl.render(p.plain, camera);
    if (!p.clip.has(1)) p.clip.set(1, primerScene(p.geo, 1));
    gl.render(p.clip.get(1)!, camera);
    gl.autoClear = prevClear;
  }, [gl, camera]);
  return null;
}

function PostFlag({ on }: { on: boolean }) {
  const gl = useThree((s) => s.gl);
  POST.set(gl, on);
  return null;
}

/**
 * Hides its content until every shader program it needs has been compiled without blocking, then shows it.
 * Remount it (key) when its content switches to new materials.
 */
export function CompileGate({ children }: { children: ReactNode }) {
  const { gl, scene, camera } = useThree();
  const ref = useRef<THREE.Group>(null);
  const [ready, setReady] = useState(() => !hasParallel(gl));
  useEffect(() => {
    if (ready || !ref.current) return;
    let alive = true;
    const root = ref.current;
    const t0 = performance.now();
    // wait a frame so effects in the subtree (materials, uniforms) have run
    const raf = requestAnimationFrame(() => {
      void envReady(gl).then(() => warmUp(gl, scene, camera, root, () => alive)).then(() => {
        if (!alive) return;
        mark("3d:ready", t0);
        setReady(true);
      });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <group ref={ref} visible={ready}>{children}</group>;
}

/** Procedural environment for reflections. */
function ProceduralEnv({ intensity = 0.6 }: { intensity?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    let alive = true;
    void envAsync(gl).then((t) => {
      if (alive) scene.environment = t;
    });
    return () => {
      alive = false;
      scene.environment = null;
    };
  }, [gl, scene]);
  useEffect(() => {
    scene.environmentIntensity = intensity;
  }, [scene, intensity]);
  useEffect(() => () => {
    void envPending.get(gl)?.then((t) => t.dispose());
    envPending.delete(gl);
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

/** True once the 2D page has painted and the browser is idle (or `timeout` ms passed): mount heavy 3D after that. */
function useAfterPaint(timeout = 700): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let idle: number | null = null, timer: number | null = null;
    const raf = requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(() => setOk(true), { timeout });
      else timer = window.setTimeout(() => setOk(true), 60);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (idle != null) window.cancelIdleCallback(idle);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [timeout]);
  return ok;
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
 * The only way the app creates a WebGL canvas. Mounts after the 2D page has painted, compiles shaders without
 * blocking (CompileGate), caps DPR, pauses rendering when hidden or off-screen, and recovers from GPU context loss
 * with an overlay + "Restore 3D" (remounts the Canvas) and one automatic retry.
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
  const painted = useAfterPaint();
  return (
    <div ref={wrap} className={/\b(absolute|fixed)\b/.test(className) ? className : `relative ${className}`}>
      {!lost && painted && <Canvas
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
        <PostFlag on={post} />
        <PrimeOnce />
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
          <CompileGate>{children}</CompileGate>
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
