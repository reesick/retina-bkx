// Builds the procedural reflection environment (RoomEnvironment -> PMREM) on an OffscreenCanvas in a worker, so the
// shader compiles and blur passes never run on the main thread. Replies with the PMREM (cube-UV) texels as half floats.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface EnvRequest { size: number }
export type EnvReply =
  | { ok: true; width: number; height: number; data: Uint16Array; colorSpace: string }
  | { ok: false; error: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<EnvRequest>) => void) | null; postMessage: (m: EnvReply, t?: Transferable[]) => void };

ctx.onmessage = (e) => {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    renderer = new THREE.WebGLRenderer({ canvas: canvas as unknown as HTMLCanvasElement, antialias: false, alpha: false, powerPreference: "high-performance" });
    const room = new RoomEnvironment();
    const cube = new THREE.WebGLCubeRenderTarget(e.data.size, { type: THREE.HalfFloatType });
    new THREE.CubeCamera(0.1, 100, cube).update(renderer, room);
    const pm = new THREE.PMREMGenerator(renderer);
    const out = pm.fromCubemap(cube.texture);
    const { width, height } = out;
    const f32 = new Float32Array(width * height * 4);
    renderer.setRenderTarget(out);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, f32);
    renderer.setRenderTarget(null);
    const data = new Uint16Array(f32.length);
    for (let i = 0; i < f32.length; i++) data[i] = THREE.DataUtils.toHalfFloat(f32[i]);
    const colorSpace = out.texture.colorSpace;
    pm.dispose();
    out.dispose();
    cube.dispose();
    (room as unknown as { dispose?: () => void }).dispose?.();
    ctx.postMessage({ ok: true, width, height, data, colorSpace }, [data.buffer]);
  } catch (err) {
    ctx.postMessage({ ok: false, error: String(err) });
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
};
