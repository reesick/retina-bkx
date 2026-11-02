import { animate, AnimatePresence, motion, useMotionValue } from "framer-motion";
import { Minus, Plus, SplitSquareHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { assetUrl } from "../../api/client";
import type { ImageResult, Lesion, LesionType } from "../../api/types";
import { LESION_COLOR, LESION_NAME, LESION_TYPES } from "../../lib/format";
import { sound } from "../../lib/sound";

export type LayerKey = "photo" | "cam" | "att" | "les" | "landmarks" | "macula" | "unimaged";
export interface ViewerLayers {
  on: Record<LayerKey, boolean>;
  opacity: Record<"cam" | "att" | "les" | "unimaged", number>;
  lesTypes: Record<LesionType, boolean>;
  split: boolean;
  splitLayer: "cam" | "att" | "les";
}
export const defaultLayers = (): ViewerLayers => ({
  on: { photo: true, cam: false, att: false, les: true, landmarks: true, macula: false, unimaged: false },
  opacity: { cam: 0.75, att: 0.75, les: 0.9, unimaged: 0.8 },
  lesTypes: { MA: true, HE: true, EX: true, SE: true },
  split: false,
  splitLayer: "cam",
});

const CAPTION: Record<LayerKey, string> = {
  photo: "Canonical photo (cropped and resized, colours unchanged).",
  cam: "Attention (CNN, Grad-CAM): regions influencing the model score.",
  att: "Attention (ViT): regions influencing the model score.",
  les: "Model-predicted lesion candidates.",
  landmarks: "Model-estimated optic disc and fovea.",
  macula: "Ring of 1 disc diameter around the estimated fovea.",
  unimaged: "Outside the photographed field: not imaged.",
};

const LABEL: Record<LayerKey, string> = {
  photo: "Photo", cam: "Attention · CNN", att: "Attention · ViT", les: "Lesions", landmarks: "Landmarks", macula: "Macula ring", unimaged: "Unimaged",
};

/** Image layers stacked in normalised space; used by the main view and the loupe. */
function LayerStack({ image, layers, splitX, side }: { image: ImageResult; layers: ViewerLayers; splitX?: number; side?: "photo" | "layer" }) {
  const o = image.urls.overlays;
  const allTypes = LESION_TYPES.every((t) => layers.lesTypes[t]);
  const clipL: CSSProperties | undefined = splitX != null && side === "layer" ? { clipPath: `inset(0 0 0 ${splitX * 100}%)` } : undefined;
  const showLayer = (k: "cam" | "att" | "les") => (layers.split ? side === "layer" && layers.splitLayer === k : layers.on[k]);
  return (
    <>
      {layers.on.photo && <img src={assetUrl(image.urls.canonical)} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none" />}
      {showLayer("cam") && o.cam && <img src={assetUrl(o.cam)} alt="" draggable={false} className="absolute inset-0 h-full w-full" style={{ opacity: layers.opacity.cam, ...clipL }} />}
      {showLayer("att") && o.attention && <img src={assetUrl(o.attention)} alt="" draggable={false} className="absolute inset-0 h-full w-full" style={{ opacity: layers.opacity.att, ...clipL }} />}
      {showLayer("les") && (allTypes ? (
        o.lesions && <img src={assetUrl(o.lesions)} alt="" draggable={false} className="absolute inset-0 h-full w-full" style={{ opacity: layers.opacity.les, ...clipL }} />
      ) : (
        LESION_TYPES.filter((t) => layers.lesTypes[t] && o[t]).map((t) => <img key={t} src={assetUrl(o[t])} alt="" draggable={false} className="absolute inset-0 h-full w-full" style={{ opacity: layers.opacity.les, ...clipL }} />)
      ))}
      {layers.on.unimaged && (
        <div className="hatch absolute inset-0" style={{ opacity: layers.opacity.unimaged, background: "#3A3A3C", WebkitMaskImage: "radial-gradient(circle at 50% 50%, transparent 49.2%, #000 50%)", maskImage: "radial-gradient(circle at 50% 50%, transparent 49.2%, #000 50%)" }} />
      )}
    </>
  );
}

export function Viewer2D({
  image, layers, setLayers, selected, onSelect,
}: { image: ImageResult; layers: ViewerLayers; setLayers: (f: (l: ViewerLayers) => ViewerLayers) => void; selected: string | null; onSelect: (id: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [z, setZ] = useState(1);
  const [hover, setHover] = useState<{ l: Lesion; px: number; py: number } | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number } | null>(null);
  const [alt, setAlt] = useState(false);
  const [splitX, setSplitX] = useState(0.5);
  const holdT = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; t: number; vx: number; vy: number } | null>(null);
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const lm = image.landmarks;
  const items = useMemo(() => (image.lesions?.items ?? []).filter((l) => layers.lesTypes[l.type]), [image.lesions, layers.lesTypes]);

  useEffect(() => scale.on("change", (v) => setZ(v)), [scale]);
  useEffect(() => {
    const d = (e: KeyboardEvent) => setAlt(e.altKey);
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", d);
    return () => { window.removeEventListener("keydown", d); window.removeEventListener("keyup", d); };
  }, []);
  // reset view when the image changes
  useEffect(() => { scale.set(1); x.set(0); y.set(0); }, [image.id, scale, x, y]);

  const clampPan = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const w = el.clientWidth;
    const max = ((scale.get() - 1) * w) / 2;
    if (Math.abs(x.get()) > max) animate(x, Math.sign(x.get()) * max, { type: "spring", stiffness: 380, damping: 30 });
    if (Math.abs(y.get()) > max) animate(y, Math.sign(y.get()) * max, { type: "spring", stiffness: 380, damping: 30 });
  }, [scale, x, y]);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s0 = scale.get();
    const s1 = Math.max(1, Math.min(8, s0 * factor));
    const px = (cx ?? r.left + r.width / 2) - r.left - r.width / 2;
    const py = (cy ?? r.top + r.height / 2) - r.top - r.height / 2;
    // keep the point under the cursor fixed
    x.set(px - ((px - x.get()) * s1) / s0);
    y.set(py - ((py - y.get()) * s1) / s0);
    scale.set(s1);
    if (s1 === 1) { x.set(0); y.set(0); }
    clampPan();
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const toNorm = (cx: number, cy: number) => {
    const el = box.current!;
    const r = el.getBoundingClientRect();
    const s = scale.get();
    const px = (cx - r.left - r.width / 2 - x.get()) / s + r.width / 2;
    const py = (cy - r.top - r.height / 2 - y.get()) / s + r.height / 2;
    return { nx: px / r.width, ny: py / r.height, lx: cx - r.left, ly: cy - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-split]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last.current = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale.get() };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const n = toNorm(e.clientX, e.clientY);
    if (alt || loupe) setLoupe({ x: n.lx, y: n.ly });
    if (!pointers.current.has(e.pointerId)) {
      // hover-hold opens the loupe
      if (holdT.current) window.clearTimeout(holdT.current);
      if (!loupe) holdT.current = window.setTimeout(() => setLoupe({ x: n.lx, y: n.ly }), 900);
      const l = items.find((it) => n.nx >= it.bbox[0] - 0.008 && n.nx <= it.bbox[0] + it.bbox[2] + 0.008 && n.ny >= it.bbox[1] - 0.008 && n.ny <= it.bbox[1] + it.bbox[3] + 0.008);
      setHover(l && layers.on.les ? { l, px: n.lx, py: n.ly } : null);
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      scale.set(Math.max(1, Math.min(8, (pinch.current.s * d) / pinch.current.d)));
      return;
    }
    const L = last.current!;
    const dx = e.clientX - L.x, dy = e.clientY - L.y;
    const now = performance.now();
    const dt = Math.max(1, now - L.t);
    if (scale.get() > 1) { x.set(x.get() + dx); y.set(y.get() + dy); }
    last.current = { x: e.clientX, y: e.clientY, t: now, vx: (dx / dt) * 1000, vy: (dy / dt) * 1000 };
  };
  const onUp = (e: React.PointerEvent) => {
    const wasDrag = last.current && (Math.abs(last.current.vx) > 50 || Math.abs(last.current.vy) > 50);
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    if (scale.get() > 1 && last.current) {
      const el = box.current!;
      const max = ((scale.get() - 1) * el.clientWidth) / 2;
      animate(x, x.get(), { type: "inertia", velocity: last.current.vx, power: 0.35, timeConstant: 260, min: -max, max, bounceStiffness: 300, bounceDamping: 30 });
      animate(y, y.get(), { type: "inertia", velocity: last.current.vy, power: 0.35, timeConstant: 260, min: -max, max, bounceStiffness: 300, bounceDamping: 30 });
    }
    if (!wasDrag && hover) { sound.tick(); onSelect(hover.l.id === selected ? null : hover.l.id); }
    else if (!wasDrag && !hover && e.detail === 1 && items.length && layers.on.les) onSelect(null);
  };

  const sel = items.find((l) => l.id === selected) ?? (image.lesions?.items ?? []).find((l) => l.id === selected);
  const activeCaptions = (Object.keys(layers.on) as LayerKey[]).filter((k) => layers.on[k] && k !== "photo");

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={box}
        className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-card bg-black"
        style={{ cursor: z > 1 ? "grab" : hover ? "pointer" : "crosshair", boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.08)" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => { setHover(null); setLoupe(null); if (holdT.current) window.clearTimeout(holdT.current); }}
        onDoubleClick={(e) => zoomAt(scale.get() > 1.5 ? 1 / scale.get() : 2.5, e.clientX, e.clientY)}
        role="img"
        aria-label={`Fundus photo ${image.eye} ${image.view}. Scroll to zoom, drag to pan, hold Alt for the loupe.`}
      >
        <motion.div className="absolute inset-0" style={{ scale, x, y }}>
          {layers.split ? (
            <>
              <LayerStack image={image} layers={{ ...layers, on: { ...layers.on, cam: false, att: false, les: false } }} />
              <LayerStack image={image} layers={layers} splitX={splitX} side="layer" />
            </>
          ) : (
            <LayerStack image={image} layers={layers} />
          )}
          <svg viewBox="0 0 1000 1000" className="pointer-events-none absolute inset-0 h-full w-full">
            {layers.on.macula && lm && <circle cx={lm.fovea.x * 1000} cy={lm.fovea.y * 1000} r={lm.disc_diameter * 1000} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={2 / z} strokeDasharray={`${8 / z} ${6 / z}`} />}
            {layers.on.landmarks && lm && (
              <>
                <Mark x={lm.od.x} y={lm.od.y} r={lm.disc_diameter * 500 + 6} z={z} label={`Disc ${(lm.od.conf * 100).toFixed(0)}%`} />
                <Mark x={lm.fovea.x} y={lm.fovea.y} r={22} z={z} label={`Fovea ${(lm.fovea.conf * 100).toFixed(0)}%`} />
              </>
            )}
            {layers.on.les && items.map((l) => {
              const isSel = l.id === selected, isHov = hover?.l.id === l.id;
              if (!isSel && !isHov) return null;
              const pad = 0.008;
              const [bx, by, bw, bh] = l.bbox;
              const W = (bw + 2 * pad) * 1000, H = (bh + 2 * pad) * 1000;
              return <rect key={l.id} x={(bx - pad) * 1000} y={(by - pad) * 1000} width={W} height={H} rx={Math.min(W, H) / 2} fill="none" stroke={isSel ? "#fff" : LESION_COLOR[l.type]} strokeWidth={(isSel ? 3 : 2) / z} style={{ filter: `drop-shadow(0 0 ${6 / z}px ${LESION_COLOR[l.type]})` }} />;
            })}
            {sel && layers.on.les && (
              <motion.circle key={sel.id} cx={sel.centroid[0] * 1000} cy={sel.centroid[1] * 1000} fill="none" stroke="#fff" strokeWidth={2 / z} initial={{ r: 8, opacity: 1 }} animate={{ r: 60 / z, opacity: 0 }} transition={{ duration: 1.2, repeat: Infinity }} />
            )}
          </svg>
        </motion.div>

        {layers.split && (
          <motion.div
            data-split
            className="absolute inset-y-0 z-20 w-8 -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${splitX * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const el = box.current!;
              const r = el.getBoundingClientRect();
              const move = (ev: PointerEvent) => setSplitX(Math.max(0.02, Math.min(0.98, (ev.clientX - r.left) / r.width)));
              const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            role="slider"
            aria-label="Split position"
            aria-valuenow={Math.round(splitX * 100)}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "ArrowLeft") setSplitX((s) => Math.max(0.02, s - 0.03)); if (e.key === "ArrowRight") setSplitX((s) => Math.min(0.98, s + 0.03)); }}
          >
            <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]" />
            <div className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-lg">
              <SplitSquareHorizontal className="h-4 w-4" />
            </div>
            <div className="absolute left-[-64px] top-3 rounded-full bg-black/60 px-2 py-0.5 text-[11px]">Photo</div>
            <div className="absolute left-[40px] top-3 whitespace-nowrap rounded-full bg-black/60 px-2 py-0.5 text-[11px]">{LABEL[layers.splitLayer]}</div>
          </motion.div>
        )}

        <AnimatePresence>
          {loupe && (
            <motion.div
              key="loupe"
              initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              className="pointer-events-none absolute z-30 h-[180px] w-[180px] overflow-hidden rounded-full"
              style={{ left: loupe.x - 90, top: loupe.y - 90, boxShadow: "0 0 0 2px #fff, 0 10px 40px rgba(0,0,0,0.7)" }}
            >
              <Loupe image={image} layers={layers} box={box} at={loupe} scale={z} x={x.get()} y={y.get()} />
            </motion.div>
          )}
        </AnimatePresence>

        {hover && !loupe && (
          <div className="glass pointer-events-none absolute z-30 rounded-[14px] px-3 py-2 text-[12px]" style={{ left: Math.min(hover.px + 14, (box.current?.clientWidth ?? 400) - 200), top: hover.py + 14 }}>
            <div className="flex items-center gap-2 font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: LESION_COLOR[hover.l.type] }} />{LESION_NAME[hover.l.type]} candidate</div>
            <div className="num mt-1 text-l2">Area {(hover.l.area_frac * 100).toFixed(3)}% · Confidence {(hover.l.confidence * 100).toFixed(0)}%</div>
            <div className="num text-l2">{hover.l.dist_fovea_dd != null ? `${hover.l.dist_fovea_dd.toFixed(2)} DD from fovea` : "Fovea not located"}</div>
          </div>
        )}

        <div className="absolute bottom-3 right-3 z-20 flex gap-1.5">
          <button type="button" className="glass grid h-8 w-8 place-items-center rounded-full" onClick={() => zoomAt(1 / 1.6)} aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
          <div className="glass num grid h-8 min-w-[48px] place-items-center rounded-full px-2 text-[12px]">{z.toFixed(1)}×</div>
          <button type="button" className="glass grid h-8 w-8 place-items-center rounded-full" onClick={() => zoomAt(1.6)} aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
        </div>
        <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-l2">Alt or hold still for the loupe</div>
      </div>

      <LayerDock image={image} layers={layers} setLayers={setLayers} />
      <div className="space-y-0.5 px-1 text-[12px] leading-snug text-l2" aria-live="polite">
        {activeCaptions.map((k) => <div key={k}>· {CAPTION[k]}</div>)}
        {layers.split && <div>· Split view: photo left, {LABEL[layers.splitLayer].toLowerCase()} right.</div>}
      </div>
    </div>
  );
}

function Loupe({ image, layers, box, at, scale, x, y }: { image: ImageResult; layers: ViewerLayers; box: React.RefObject<HTMLDivElement>; at: { x: number; y: number }; scale: number; x: number; y: number }) {
  const W = box.current?.clientWidth ?? 500;
  const k = 3;
  // point in content space under the cursor
  const cx = (at.x - W / 2 - x) / scale + W / 2;
  const cy = (at.y - W / 2 - y) / scale + W / 2;
  const S = W * scale * k;
  return (
    <div className="absolute bg-black" style={{ width: S, height: S, left: 90 - (cx / W) * S, top: 90 - (cy / W) * S }}>
      <LayerStack image={image} layers={{ ...layers, split: false }} />
    </div>
  );
}

function Mark({ x, y, r, z, label }: { x: number; y: number; r: number; z: number; label: string }) {
  const X = x * 1000, Y = y * 1000;
  const w = 2 / z;
  return (
    <g>
      <circle cx={X} cy={Y} r={r} fill="none" stroke="#fff" strokeWidth={w} opacity={0.9} />
      {[0, 90, 180, 270].map((a) => {
        const t = (a * Math.PI) / 180;
        return <line key={a} x1={X + Math.cos(t) * (r + 4 / z)} y1={Y + Math.sin(t) * (r + 4 / z)} x2={X + Math.cos(t) * (r + 16 / z)} y2={Y + Math.sin(t) * (r + 16 / z)} stroke="#fff" strokeWidth={w} />;
      })}
      <text x={X + r + 18 / z} y={Y - r - 4 / z} fill="#fff" fontSize={18 / z} fontWeight={600} style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.7)", strokeWidth: 3 / z }}>{label}</text>
    </g>
  );
}

function LayerDock({ image, layers, setLayers }: { image: ImageResult; layers: ViewerLayers; setLayers: (f: (l: ViewerLayers) => ViewerLayers) => void }) {
  const toggle = (k: LayerKey) => { sound.tick(); setLayers((l) => ({ ...l, on: { ...l.on, [k]: !l.on[k] } })); };
  const sum = image.lesions?.summary;
  const opacityKey = (k: LayerKey): "cam" | "att" | "les" | "unimaged" | null => (k === "cam" || k === "att" || k === "les" || k === "unimaged" ? k : null);
  const [focus, setFocus] = useState<"cam" | "att" | "les" | "unimaged">("les");
  return (
    <div className="glass rounded-[18px] p-2">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(LABEL) as LayerKey[]).map((k) => {
          const on = layers.on[k];
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => { toggle(k); const ok = opacityKey(k); if (ok) setFocus(ok); }}
              className={`h-8 rounded-full px-3 text-[12px] font-medium transition-colors ${on ? "bg-white text-black" : "bg-white/[0.06] text-white/75 hover:bg-white/10"}`}
            >
              {LABEL[k]}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={layers.split}
          onClick={() => { sound.tick(); setLayers((l) => ({ ...l, split: !l.split })); }}
          className={`ml-auto flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium ${layers.split ? "bg-white text-black" : "bg-white/[0.06] text-white/75 hover:bg-white/10"}`}
        >
          <SplitSquareHorizontal className="h-3.5 w-3.5" /> Split
        </button>
      </div>
      {layers.on.les && sum && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-2">
          {LESION_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={layers.lesTypes[t]}
              onClick={() => { sound.tick(); setLayers((l) => ({ ...l, lesTypes: { ...l.lesTypes, [t]: !l.lesTypes[t] } })); }}
              className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold transition-opacity"
              style={{ background: `${LESION_COLOR[t]}22`, color: LESION_COLOR[t], opacity: layers.lesTypes[t] ? 1 : 0.35 }}
              title={LESION_NAME[t]}
            >
              {t} <span className="num font-medium opacity-80">{sum[t].count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 border-t border-white/[0.06] px-1 pt-2">
        {layers.split ? (
          <>
            <span className="text-[12px] text-l2">Split layer</span>
            {(["cam", "att", "les"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setLayers((l) => ({ ...l, splitLayer: k }))} className={`h-7 rounded-full px-2.5 text-[12px] ${layers.splitLayer === k ? "bg-white/20 text-white" : "text-l2"}`}>{LABEL[k]}</button>
            ))}
          </>
        ) : (
          <>
            <select value={focus} onChange={(e) => setFocus(e.target.value as typeof focus)} className="h-7 rounded-full bg-white/[0.06] px-2 text-[12px] text-white" aria-label="Layer for opacity">
              <option value="cam">Attention · CNN</option>
              <option value="att">Attention · ViT</option>
              <option value="les">Lesions</option>
              <option value="unimaged">Unimaged</option>
            </select>
            <input
              type="range" min={0} max={1} step={0.01} value={layers.opacity[focus]} className="slider flex-1"
              style={{ ["--fill" as string]: `${layers.opacity[focus] * 100}%` }}
              onChange={(e) => setLayers((l) => ({ ...l, opacity: { ...l.opacity, [focus]: Number(e.target.value) } }))}
              aria-label="Layer opacity"
            />
            <span className="num w-9 text-right text-[12px] text-l2">{Math.round(layers.opacity[focus] * 100)}%</span>
          </>
        )}
      </div>
    </div>
  );
}
