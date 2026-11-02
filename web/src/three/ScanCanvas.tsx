// WebGL scan sweep for the analysis theatre: a soft luminance band with fine scanlines that brightens the
// photo's own structure as it passes. Raw WebGL (one quad) so it costs almost nothing.
import { useEffect, useRef } from "react";

const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision mediump float;
varying vec2 uv;
uniform sampler2D uImg; uniform float uHas; uniform float uTime; uniform float uPos; uniform float uOn; uniform vec3 uTint;
void main(){
  vec2 q = vec2(uv.x, 1.0 - uv.y);
  float r = distance(q, vec2(0.5));
  if (r > 0.5) discard;
  vec3 img = uHas > 0.5 ? texture2D(uImg, q).rgb : vec3(0.4);
  float lum = dot(img, vec3(0.3, 0.59, 0.11));
  float d = q.y - uPos;
  float band = exp(-pow(d / 0.045, 2.0));
  float trail = d < 0.0 ? exp(d / 0.22) * 0.35 : 0.0;
  float lines = 0.55 + 0.45 * sin(q.y * 820.0 + uTime * 3.0);
  // edge glow: structure (vessels, disc) lights up as the band passes
  vec2 px = vec2(1.0 / 512.0);
  float lx = uHas > 0.5 ? abs(dot(texture2D(uImg, q + vec2(px.x, 0.0)).rgb - texture2D(uImg, q - vec2(px.x, 0.0)).rgb, vec3(0.33))) : 0.0;
  float ly = uHas > 0.5 ? abs(dot(texture2D(uImg, q + vec2(0.0, px.y)).rgb - texture2D(uImg, q - vec2(0.0, px.y)).rgb, vec3(0.33))) : 0.0;
  float edge = clamp((lx + ly) * 9.0, 0.0, 1.0);
  float a = (band * (0.35 + lum * 1.3) * lines + trail * edge * 1.2 + band * edge * 1.5) * uOn;
  float vign = smoothstep(0.5, 0.42, r);
  gl_FragColor = vec4(mix(vec3(1.0), uTint, 0.25) * a * vign, 1.0);
}`;

export function ScanCanvas({ src, active, size, tint = [1, 1, 1] }: { src: string | undefined; active: boolean; size: number; tint?: [number, number, number] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ active, tint });
  state.current = { active, tint };
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const gl = c.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: false });
    if (!gl) return;
    const sh = (type: number, s: string) => {
      const o = gl.createShader(type)!;
      gl.shaderSource(o, s);
      gl.compileShader(o);
      return o;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uHas = U("uHas"), uTime = U("uTime"), uPos = U("uPos"), uOn = U("uOn"), uTint = U("uTint");
    gl.uniform1i(U("uImg"), 0);
    gl.uniform1f(uHas, 0);
    const tex = gl.createTexture();
    let alive = true;
    if (src) {
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1f(uHas, 1);
      };
      img.src = src;
    }
    let on = 0;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      on += ((state.current.active ? 1 : 0) - on) * 0.06;
      const ph = (t / 2.4) % 2;
      const pos = ph < 1 ? ph : 2 - ph; // ping-pong sweep
      gl.viewport(0, 0, c.width, c.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uPos, -0.1 + pos * 1.2);
      gl.uniform1f(uOn, on);
      gl.uniform3f(uTint, ...state.current.tint);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [src]);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return (
    <canvas
      ref={ref}
      width={Math.round(Math.min(size, 900) * dpr)}
      height={Math.round(Math.min(size, 900) * dpr)}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full rounded-full"
      style={{ mixBlendMode: "screen" }}
    />
  );
}
