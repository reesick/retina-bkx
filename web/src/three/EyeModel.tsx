// The procedural eye (docs/05_UI_UX.md §4). Units: millimetres. Optical axis = −Z, front at +Z.
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Eye } from "../api/types";
import { nerveDirection, POSTERIOR_POLE, angleDeg, type Projection, type V3 } from "./projection";
import { IRIS_FRAG, IRIS_VERT, RETINA_FRAG, RETINA_VERT, SCLERA_FRAG, SCLERA_VERT } from "./shaders";

export type PartName =
  | "cornea" | "iris" | "pupil" | "lens" | "ciliary" | "vitreous" | "retina" | "macula" | "disc" | "choroid" | "sclera" | "nerve";

export const PART_INFO: Record<PartName, { name: string; line: string }> = {
  cornea: { name: "Cornea", line: "Clear front window. Does about two thirds of the focusing." },
  iris: { name: "Iris", line: "Coloured muscle ring that sets the pupil size." },
  pupil: { name: "Pupil", line: "The opening in the iris. Light and the fundus camera both pass through it." },
  lens: { name: "Lens", line: "Changes shape to focus near or far (accommodation)." },
  ciliary: { name: "Ciliary body", line: "Muscle that changes the lens shape and makes aqueous fluid." },
  vitreous: { name: "Vitreous", line: "Clear gel filling the eye behind the lens." },
  retina: { name: "Retina", line: "Light-sensitive layer. This is what a fundus photo shows." },
  macula: { name: "Macula / fovea", line: "Centre of sharp vision. Exudates near it matter most." },
  disc: { name: "Optic disc", line: "Where the nerve and vessels leave the eye. No photoreceptors: the blind spot." },
  choroid: { name: "Choroid", line: "Vascular layer that feeds the outer retina. Gives the fundus its red-orange." },
  sclera: { name: "Sclera", line: "Tough white outer coat." },
  nerve: { name: "Optic nerve", line: "Carries the signal to the brain. Leaves about 15° nasal of the fovea." },
};

export const IRIS_COLORS: Record<string, string> = { brown: "#5a3a22", hazel: "#7a5a2a", green: "#4f6a3a", blue: "#4a6e94", grey: "#6f7a80" };

export interface RetinaConfig {
  fundus?: THREE.Texture | null;
  cam?: THREE.Texture | null; att?: THREE.Texture | null; les?: THREE.Texture | null;
  camOn?: number; attOn?: number; lesOn?: number;
  projection?: Projection | null;
  showUnimaged?: boolean;
  selected?: V3 | null;
  caps?: { dirs: V3[]; half: number[]; color?: string } | null;
}

export interface EyeModelProps {
  eye?: Eye;
  /** Pupil radius in mm (diameter/2). Read every frame from a ref when animating. */
  pupilRef?: MutableRefObject<number>;
  pupil?: number;
  shimmerRef?: MutableRefObject<number>;
  irisColor?: string;
  explode?: number;
  /** Keep x ≤ sectionX (mm). null = no clipping. */
  sectionX?: number | null;
  retina?: RetinaConfig;
  highlight?: PartName | null;
  onHover?: (p: PartName | null, point?: THREE.Vector3) => void;
  onRetinaClick?: (dir: V3, e: ThreeEvent<MouseEvent>) => void;
  showVitreous?: boolean;
  /** Hide front parts (used for inside views). */
  hideFront?: boolean;
  /** Render only these parts. */
  only?: PartName[];
}

const D2R = Math.PI / 180;
const SCLERA_CUT = 32 * D2R;
const LIMBUS_R = 12 * Math.sin(SCLERA_CUT);
const LIMBUS_Z = 12 * Math.cos(SCLERA_CUT);
const CORNEA_R = 7.8;
const CORNEA_HALF = Math.asin(LIMBUS_R / CORNEA_R);
const CORNEA_CZ = LIMBUS_Z - CORNEA_R * Math.cos(CORNEA_HALF);
export const CORNEA_APEX_Z = CORNEA_CZ + CORNEA_R;
const IRIS_Z = 9.0;
const LENS_FRONT_Z = 8.75;

function capSphere(r: number, thetaStart: number, segs = 96) {
  // three's sphere poles are on ±Y; rotate so the removed cap sits around +Z (the front)
  const g = new THREE.SphereGeometry(r, segs, Math.round(segs * 0.66), 0, Math.PI * 2, thetaStart, Math.PI - thetaStart);
  g.rotateX(Math.PI / 2);
  return g;
}

function lensGeometry(thick = 3.8, Rf = 10.2, Rb = 6.0, semi = 4.5) {
  const pts: THREE.Vector2[] = [];
  const sf = Rf - Math.sqrt(Rf * Rf - semi * semi);
  const sb = Rb - Math.sqrt(Rb * Rb - semi * semi);
  const edge = Math.max(0.2, thick - sf - sb);
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const r = (semi * i) / N;
    pts.push(new THREE.Vector2(Math.max(r, 1e-3), -(Rf - Math.sqrt(Rf * Rf - r * r))));
  }
  pts.push(new THREE.Vector2(semi, -sf - edge));
  for (let i = N; i >= 0; i--) {
    const r = (semi * i) / N;
    pts.push(new THREE.Vector2(Math.max(r, 1e-3), -thick + (Rb - Math.sqrt(Rb * Rb - r * r))));
  }
  const g = new THREE.LatheGeometry(pts, 96);
  g.rotateX(Math.PI / 2); // lathe axis Y -> Z; front apex at z=0, back at z=-thick
  return g;
}

const whiteTex = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export function EyeModel({
  eye = "OD", pupilRef, pupil = 1.5, shimmerRef, irisColor = IRIS_COLORS.brown, explode = 0, sectionX = null, retina,
  highlight = null, onHover, onRetinaClick, showVitreous = true, hideFront = false, only,
}: EyeModelProps) {
  const nerve = useMemo(() => nerveDirection(eye), [eye]);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 100), []);
  const planes = useMemo(() => [plane], [plane]);
  useEffect(() => {
    plane.constant = sectionX == null ? 1000 : sectionX;
  }, [sectionX, plane]);

  const geo = useMemo(() => ({
    sclera: capSphere(12, SCLERA_CUT),
    choroid: capSphere(11.88, 36 * D2R),
    retina: capSphere(11.75, 40 * D2R, 128),
    vitreous: new THREE.SphereGeometry(11.6, 64, 40),
    cornea: (() => {
      const g = new THREE.SphereGeometry(CORNEA_R, 96, 32, 0, Math.PI * 2, 0, CORNEA_HALF);
      g.rotateX(Math.PI / 2);
      return g;
    })(),
    iris: new THREE.RingGeometry(0.3, 5.9, 160, 6),
    pupil: new THREE.CircleGeometry(1, 64),
    lens: lensGeometry(),
    ciliary: new THREE.TorusGeometry(5.7, 0.75, 20, 120),
    nerve: new THREE.CylinderGeometry(1.5, 1.7, 16, 48, 1, true),
    sheath: new THREE.CylinderGeometry(2.1, 2.3, 15.5, 48, 1, true),
  }), []);

  const mats = useMemo(() => {
    const key = new THREE.Vector3(0.6, 0.7, 0.9);
    const sclera = new THREE.ShaderMaterial({
      vertexShader: SCLERA_VERT, fragmentShader: SCLERA_FRAG, side: THREE.DoubleSide, clipping: true,
      uniforms: { uKey: { value: key }, uRim: { value: new THREE.Vector3(-0.5, 0.2, -1) }, uHighlight: { value: 0 } },
    });
    const retinaM = new THREE.ShaderMaterial({
      vertexShader: RETINA_VERT, fragmentShader: RETINA_FRAG, side: THREE.DoubleSide, clipping: true,
      uniforms: {
        uFundus: { value: whiteTex }, uHasFundus: { value: 0 },
        uCam: { value: whiteTex }, uCamOn: { value: 0 }, uAtt: { value: whiteTex }, uAttOn: { value: 0 }, uLes: { value: whiteTex }, uLesOn: { value: 0 },
        uA: { value: new THREE.Vector3(0, 0, -1) }, uEx: { value: new THREE.Vector3(1, 0, 0) }, uEy: { value: new THREE.Vector3(0, -1, 0) },
        uHalfFov: { value: 22.5 * D2R }, uShowUnimaged: { value: 1 },
        uSel: { value: new THREE.Vector3(0, 0, -1) }, uSelOn: { value: 0 }, uTime: { value: 0 },
        uNerve: { value: new THREE.Vector3(...nerve) }, uHighlight: { value: 0 },
        uCapDirs: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 0, -1)) }, uCapHalf: { value: [0, 0, 0, 0] },
        uCapColor: { value: new THREE.Color("#64D2FF") }, uCapOn: { value: 0 },
      },
    });
    const iris = new THREE.ShaderMaterial({
      vertexShader: IRIS_VERT, fragmentShader: IRIS_FRAG, side: THREE.DoubleSide, clipping: true,
      uniforms: { uColor: { value: new THREE.Color(irisColor) }, uPupil: { value: 1.5 }, uOuter: { value: 5.9 }, uTime: { value: 0 }, uShimmer: { value: 0 }, uHighlight: { value: 0 } },
    });
    const cornea = new THREE.MeshPhysicalMaterial({
      transmission: 1, ior: 1.376, thickness: 0.55, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.03,
      metalness: 0, color: "#ffffff", transparent: true, opacity: 1, side: THREE.FrontSide, clippingPlanes: planes, envMapIntensity: 1.2,
      specularIntensity: 1,
    });
    const lens = new THREE.MeshPhysicalMaterial({
      transmission: 1, ior: 1.42, thickness: 3.8, roughness: 0.06, color: "#fff2cf", attenuationColor: new THREE.Color("#ffe7a8"), attenuationDistance: 12,
      clippingPlanes: planes, side: THREE.FrontSide, transparent: true,
    });
    const lensCap = new THREE.MeshBasicMaterial({ color: "#d9c48f", side: THREE.BackSide, clippingPlanes: planes, transparent: true, opacity: 0.85 });
    const choroid = new THREE.MeshStandardMaterial({ color: "#5a0f0c", roughness: 0.7, side: THREE.DoubleSide, clippingPlanes: planes });
    const ciliary = new THREE.MeshStandardMaterial({ color: "#3a2016", roughness: 0.8, clippingPlanes: planes });
    const vitreous = new THREE.MeshPhysicalMaterial({ color: "#cfe8ff", transparent: true, opacity: 0.035, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: planes });
    const pupilM = new THREE.MeshBasicMaterial({ color: "#030202", side: THREE.DoubleSide, clippingPlanes: planes });
    const nerveM = new THREE.MeshStandardMaterial({ color: "#e6d3a3", roughness: 0.6, side: THREE.DoubleSide, clippingPlanes: planes });
    const sheath = new THREE.MeshStandardMaterial({ color: "#efe6d8", transparent: true, opacity: 0.35, roughness: 0.5, side: THREE.DoubleSide, clippingPlanes: planes, depthWrite: false });
    for (const m of [sclera, retinaM, iris]) m.clippingPlanes = planes;
    return { sclera, retina: retinaM, iris, cornea, lens, lensCap, choroid, ciliary, vitreous, pupil: pupilM, nerve: nerveM, sheath };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planes]);

  useEffect(() => {
    (mats.iris.uniforms.uColor.value as THREE.Color).set(irisColor);
  }, [irisColor, mats]);
  useEffect(() => {
    (mats.retina.uniforms.uNerve.value as THREE.Vector3).set(...nerve);
  }, [nerve, mats]);

  // retina uniforms
  useEffect(() => {
    const u = mats.retina.uniforms;
    const r = retina ?? {};
    u.uHasFundus.value = r.fundus ? 1 : 0;
    u.uFundus.value = r.fundus ?? whiteTex;
    u.uCam.value = r.cam ?? whiteTex;
    u.uAtt.value = r.att ?? whiteTex;
    u.uLes.value = r.les ?? whiteTex;
    u.uCamOn.value = r.cam ? r.camOn ?? 0 : 0;
    u.uAttOn.value = r.att ? r.attOn ?? 0 : 0;
    u.uLesOn.value = r.les ? r.lesOn ?? 0 : 0;
    u.uShowUnimaged.value = r.showUnimaged === false ? 0 : 1;
    const p = r.projection;
    if (p) {
      (u.uA.value as THREE.Vector3).set(...p.A);
      (u.uEx.value as THREE.Vector3).set(...p.Ex);
      (u.uEy.value as THREE.Vector3).set(...p.Ey);
      u.uHalfFov.value = p.halfFov;
    }
    u.uSelOn.value = r.selected ? 1 : 0;
    if (r.selected) (u.uSel.value as THREE.Vector3).set(...r.selected);
    if (r.caps) {
      u.uCapOn.value = 1;
      for (let i = 0; i < 4; i++) {
        const d = r.caps.dirs[i];
        (u.uCapDirs.value as THREE.Vector3[])[i].set(...(d ?? POSTERIOR_POLE));
        (u.uCapHalf.value as number[])[i] = r.caps.half[i] ?? 0;
      }
      (u.uCapColor.value as THREE.Color).set(r.caps.color ?? "#64D2FF");
    } else u.uCapOn.value = 0;
  }, [retina, mats]);

  useEffect(() => {
    const H = (p: PartName) => (highlight === p ? 1 : 0);
    mats.sclera.uniforms.uHighlight.value = H("sclera");
    mats.iris.uniforms.uHighlight.value = H("iris");
    mats.retina.uniforms.uHighlight.value = H("retina") || H("macula") || H("disc") ? 0.6 : 0;
    const glow = (m: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial, on: boolean, c = "#ffffff") => {
      m.emissive = new THREE.Color(c);
      m.emissiveIntensity = on ? 0.35 : 0;
    };
    glow(mats.choroid, highlight === "choroid", "#ff6a50");
    glow(mats.ciliary, highlight === "ciliary", "#ffb080");
    glow(mats.nerve, highlight === "nerve", "#ffe7a0");
    mats.vitreous.opacity = highlight === "vitreous" ? 0.16 : showVitreous ? 0.035 : 0;
    mats.lensCap.color.set(highlight === "lens" ? "#fff0b8" : "#d9c48f");
    mats.cornea.emissive = new THREE.Color("#9fd8ff");
    mats.cornea.emissiveIntensity = highlight === "cornea" ? 0.25 : 0;
    (mats.pupil.color as THREE.Color).set(highlight === "pupil" ? "#2a2a2a" : "#030202");
  }, [highlight, mats, showVitreous]);

  const pupilMesh = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const pr = pupilRef ? pupilRef.current : pupil;
    mats.iris.uniforms.uPupil.value = pr;
    mats.iris.uniforms.uTime.value = t;
    mats.iris.uniforms.uShimmer.value = shimmerRef ? shimmerRef.current : 0;
    mats.retina.uniforms.uTime.value = t;
    if (pupilMesh.current) pupilMesh.current.scale.setScalar(pr);
  });

  const e = explode;
  const nervePos = useMemo(() => new THREE.Vector3(...nerve).multiplyScalar(12 + 7.4), [nerve]);
  const nerveQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...nerve)), [nerve]);

  const clipped = (pt: THREE.Vector3) => sectionX != null && pt.x > sectionX;
  const clippedPt = clipped;
  const hover = (p: PartName, yieldTo: string[] | "all" | null = null) => ({
    onPointerMove: onHover ? (ev: ThreeEvent<PointerEvent>) => {
      if (clipped(ev.point)) return;
      // transparent parts yield to the parts behind them (cornea -> iris/pupil, vitreous -> everything)
      if (yieldTo && ev.intersections.some((i) => i.object !== ev.object && !clippedPt(i.point) && (yieldTo === "all" || yieldTo.includes(i.object.name)))) return;
      ev.stopPropagation();
      onHover(p, ev.point);
    } : undefined,
    onPointerOut: onHover ? () => onHover(null) : undefined,
  });
  const irisHover = {
    onPointerMove: onHover ? (ev: ThreeEvent<PointerEvent>) => {
      if (clipped(ev.point)) return;
      ev.stopPropagation();
      const l = ev.object.worldToLocal(ev.point.clone());
      const pr = pupilRef ? pupilRef.current : pupil;
      onHover(Math.hypot(l.x, l.y) < pr ? "pupil" : "iris", ev.point);
    } : undefined,
    onPointerOut: onHover ? () => onHover(null) : undefined,
  };

  const retinaPart = (ev: ThreeEvent<PointerEvent | MouseEvent>): { part: PartName; dir: V3 } => {
    const obj = ev.object;
    const local = obj.worldToLocal(ev.point.clone()).normalize();
    const dir: V3 = [local.x, local.y, local.z];
    if (angleDeg(dir, POSTERIOR_POLE) < 7) return { part: "macula", dir };
    if (angleDeg(dir, nerve) < 5) return { part: "disc", dir };
    return { part: "retina", dir };
  };

  const show = (p: PartName) => !only || only.includes(p);
  const front = !hideFront;
  return (
    <group>
      {/* posterior shells */}
      {show("sclera") && <mesh geometry={geo.sclera} material={mats.sclera} position={[0, 0, -9 * e]} {...hover("sclera")} renderOrder={1} />}
      {show("nerve") && (
        <group position={[0, 0, -9 * e]}>
          <mesh geometry={geo.nerve} material={mats.nerve} position={nervePos} quaternion={nerveQuat} {...hover("nerve")} />
          <mesh geometry={geo.sheath} material={mats.sheath} position={nervePos} quaternion={nerveQuat} />
        </group>
      )}
      {show("choroid") && <mesh geometry={geo.choroid} material={mats.choroid} position={[0, 0, -6 * e]} {...hover("choroid")} />}
      {show("retina") && (
        <mesh
          geometry={geo.retina}
          material={mats.retina}
          position={[0, 0, -3 * e]}
          onPointerMove={onHover ? (ev) => { if (clipped(ev.point)) return; ev.stopPropagation(); onHover(retinaPart(ev).part, ev.point); } : undefined}
          onPointerOut={onHover ? () => onHover(null) : undefined}
          onClick={onRetinaClick ? (ev) => { ev.stopPropagation(); onRetinaClick(retinaPart(ev).dir, ev); } : undefined}
        />
      )}
      {showVitreous && show("vitreous") && <mesh geometry={geo.vitreous} material={mats.vitreous} {...hover("vitreous", "all")} renderOrder={2} />}
      {front && show("ciliary") && <mesh geometry={geo.ciliary} material={mats.ciliary} position={[0, 0, 7.7 + 6 * e]} {...hover("ciliary")} />}
      {front && show("lens") && (
        <group position={[0, 0, LENS_FRONT_Z + 4.5 * e]}>
          <mesh geometry={geo.lens} material={mats.lensCap} />
          <mesh geometry={geo.lens} material={mats.lens} {...hover("lens")} renderOrder={3} />
        </group>
      )}
      {front && show("iris") && (
        <>
          <mesh ref={pupilMesh} geometry={geo.pupil} material={mats.pupil} position={[0, 0, IRIS_Z - 0.06 + 8 * e]} raycast={() => null} />
          <mesh name="iris" geometry={geo.iris} material={mats.iris} position={[0, 0, IRIS_Z + 8 * e]} {...irisHover} />
        </>
      )}
      {front && show("cornea") && <mesh geometry={geo.cornea} material={mats.cornea} position={[0, 0, CORNEA_CZ + 12 * e]} {...hover("cornea", ["iris"])} renderOrder={4} />}
    </group>
  );
}
