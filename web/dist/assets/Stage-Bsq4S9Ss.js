import{a as u,j as l}from"./ui-1z3KOePw.js";import{o as Pe,c as E,ae as de,af as qe,ag as Be,ah as Ze,ai as ie,u as oe,D,h as W,aj as se,a7 as ve,ak as Q,a6 as Se,al as V,Q as $e,d as ae,am as Ke,an as _e,S as Ee,ao as Qe,ap as Je,x as S,A as Xe,f as Ye,F as et,Z as tt,ab as ce,g as nt,aq as ot,_ as st,ar as at,as as rt,at as it,au as ct,H as Fe,av as lt}from"./three-CmWbwWp9.js";import{u as ut,C as pt,P as mt,E as ft,B as dt,V as vt,a as Y}from"./r3f-CgDJ-BDv.js";import{u as he,ab as ge}from"./index-Dmcia6hW.js";const G=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],je=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],j=(e,t)=>[e[0]*t,e[1]*t,e[2]*t],H=(e,t)=>[e[0]+t[0],e[1]+t[1],e[2]+t[2]],ht=e=>Math.hypot(e[0],e[1],e[2]),R=e=>j(e,1/(ht(e)||1));function xe(e,t,n){const o=Math.cos(n),s=Math.sin(n);return H(H(j(e,o),j(je(t,e),s)),j(t,G(t,e)*(1-o)))}const q=[0,0,-1],we=15.5,B=Math.PI/180,L=.5,J=.5,gt=(e,t)=>[e,-t,0];function xt({fovea:e,disc:t,fovDeg:n},o=2.5){const s=n/2*B,r=[e.x-L,e.y-L],c=Math.hypot(r[0],r[1])/J*s;let h=q,d=[1,0,0],f=[0,-1,0];if(c>1e-9){const p=R(gt(r[0],r[1])),C=R(H(j(q,Math.cos(c)),j(p,-Math.sin(c)))),w=R(je(q,C));h=C,d=xe(d,w,c),f=xe(f,w,c)}const g={A:h,Ex:d,Ey:f,halfFov:s,thetaScale:1,scaled:!1,discFoveaDegRaw:NaN,fovDeg:n};if(!t)return g;const M=ye(g,t.x,t.y),F=ye(g,e.x,e.y),v=Math.acos(Math.max(-1,Math.min(1,G(M,F))))/B;if(g.discFoveaDegRaw=v,v>1&&Math.abs(v-we)>o){const p=we/v;return{...xt({fovea:e,disc:null,fovDeg:n*p}),thetaScale:p,scaled:!0,discFoveaDegRaw:v,fovDeg:n}}return g}function ye(e,t,n){const o=t-L,s=n-L,r=Math.hypot(o,s);if(r<1e-12)return e.A;const c=r/J*e.halfFov,h=R(H(j(e.Ex,o/r),j(e.Ey,s/r)));return R(H(j(e.A,Math.cos(c)),j(h,Math.sin(c))))}function Qt(e,t){const n=R(t),o=Math.max(-1,Math.min(1,G(n,e.A))),s=Math.acos(o),r=H(n,j(e.A,-o)),c=G(r,e.Ex),h=G(r,e.Ey),d=Math.hypot(c,h)||1,f=s/e.halfFov*J,g=L+f*c/d,M=L+f*h/d;return{x:g,y:M,inside:s<=e.halfFov&&Math.hypot(g-L,M-L)<=J,theta:s}}function wt(e,t=15.5,n=1.5){const o=e==="OD"?1:-1,s=t*B,r=n*B;return R([o*Math.sin(s),Math.sin(r),-Math.cos(s)*Math.cos(r)])}function Me(e,t){return Math.acos(Math.max(-1,Math.min(1,G(R(e),R(t)))))/B}const le=`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`,yt=`
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vDir;
varying vec3 vNormalV;
void main(){
  vDir = normalize(position);
  vNormalV = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`,Mt=`
#include <common>
#include <clipping_planes_pars_fragment>
${le}
uniform sampler2D uFundus; uniform float uHasFundus;
uniform sampler2D uCam; uniform float uCamOn;
uniform sampler2D uAtt; uniform float uAttOn;
uniform sampler2D uLes; uniform float uLesOn;
uniform vec3 uA; uniform vec3 uEx; uniform vec3 uEy; uniform float uHalfFov;
uniform float uShowUnimaged;
uniform vec3 uSel; uniform float uSelOn; uniform float uTime;
uniform vec3 uNerve; uniform float uHighlight;
uniform vec3 uCapDirs[4]; uniform float uCapHalf[4]; uniform vec3 uCapColor; uniform float uCapOn;
varying vec3 vDir;
varying vec3 vNormalV;

vec3 genericRetina(vec3 d){
  // generic fundus colour: orange-red, darker macula at the posterior pole, pale disc at the nerve head
  float n = snoise(d * 9.0) * 0.5 + snoise(d * 23.0) * 0.25;
  vec3 col = vec3(0.70, 0.25, 0.10) + n * vec3(0.05, 0.02, 0.01);
  float aMac = acos(clamp(dot(d, vec3(0.0, 0.0, -1.0)), -1.0, 1.0));
  col *= mix(0.55, 1.0, smoothstep(0.02, 0.2, aMac));
  float aDisc = acos(clamp(dot(d, uNerve), -1.0, 1.0));
  col = mix(col, vec3(1.0, 0.86, 0.6), 1.0 - smoothstep(0.045, 0.075, aDisc));
  // vessel-like ridges radiating from the disc
  float ridge = 1.0 - abs(snoise(vec3(d.xy * 6.0 + uNerve.xy * 3.0, aDisc * 3.0)));
  col = mix(col, vec3(0.42, 0.05, 0.03), pow(ridge, 14.0) * smoothstep(1.2, 0.08, aDisc) * 0.8);
  // periphery darkens toward the ora serrata
  col *= mix(1.0, 0.55, smoothstep(1.4, 2.3, aMac));
  return col;
}

void main(){
  #include <clipping_planes_fragment>
  vec3 d = normalize(vDir);
  vec3 base = genericRetina(d);
  vec3 col = base;
  float cs = clamp(dot(d, uA), -1.0, 1.0);
  float th = acos(cs);
  vec3 t = d - uA * cs;
  float tx = dot(t, uEx), ty = dot(t, uEy);
  float tl = max(length(vec2(tx, ty)), 1e-6);
  float rr = th / uHalfFov * 0.5;
  vec2 q = vec2(0.5) + rr * vec2(tx, ty) / tl;
  vec2 uv = vec2(q.x, 1.0 - q.y);
  if (uHasFundus > 0.5) {
    float edge = th / uHalfFov;
    float fadeW = radians(2.0) / uHalfFov;
    float inside = 1.0 - smoothstep(1.0 - fadeW, 1.0, edge);
    vec3 unimaged = vec3(0.227, 0.227, 0.235);
    float hatch = step(0.82, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
    unimaged += hatch * 0.09;
    vec3 outside = uShowUnimaged > 0.5 ? unimaged : base * 0.6;
    vec3 photo = texture2D(uFundus, uv).rgb;
    // the photo's own black corners count as un-imaged
    float lum = dot(photo, vec3(0.333));
    float photoMask = smoothstep(0.015, 0.06, lum) * inside;
    vec3 inner = photo;
    vec4 c = texture2D(uCam, uv); inner = mix(inner, c.rgb, c.a * uCamOn);
    vec4 a = texture2D(uAtt, uv); inner = mix(inner, a.rgb, a.a * uAttOn);
    vec4 l = texture2D(uLes, uv); inner = mix(inner, l.rgb, l.a * uLesOn);
    col = mix(outside, inner, photoMask);
    // soft border line between imaged and not imaged
    col += vec3(0.25) * (1.0 - smoothstep(0.0, fadeW * 0.6, abs(edge - 1.0))) * uShowUnimaged;
  }
  if (uCapOn > 0.5) {
    float cover = 0.0;
    for (int i = 0; i < 4; i++) {
      if (uCapHalf[i] > 0.0) {
        float ang = acos(clamp(dot(d, uCapDirs[i]), -1.0, 1.0));
        cover = max(cover, 1.0 - smoothstep(uCapHalf[i] - 0.01, uCapHalf[i] + 0.01, ang));
      }
    }
    vec3 grey = vec3(0.227, 0.227, 0.235) + step(0.82, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0)) * 0.09;
    col = mix(grey, mix(base, uCapColor, 0.18), cover);
  }
  if (uSelOn > 0.5) {
    float ang = acos(clamp(dot(d, uSel), -1.0, 1.0));
    float pr = 0.02 + 0.025 * fract(uTime * 0.9);
    float ring = 1.0 - smoothstep(0.0, 0.006, abs(ang - pr));
    col = mix(col, vec3(1.0), ring * (1.0 - fract(uTime * 0.9)));
    col += vec3(1.0) * (1.0 - smoothstep(0.0, 0.01, ang)) * 0.6;
  }
  // gentle shading so the bowl reads as curved
  float shade = 0.82 + 0.18 * abs(vNormalV.z);
  col *= shade;
  col += vec3(0.25, 0.18, 0.1) * uHighlight;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`,Ct=`
#include <common>
#include <clipping_planes_pars_vertex>
varying vec2 vP;
void main(){
  vP = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`,bt=`
#include <common>
#include <clipping_planes_pars_fragment>
${le}
uniform vec3 uColor; uniform float uPupil; uniform float uOuter; uniform float uTime; uniform float uShimmer; uniform float uHighlight;
varying vec2 vP;
void main(){
  #include <clipping_planes_fragment>
  float r = length(vP);
  if (r < uPupil) discard;
  float a = atan(vP.y, vP.x);
  float u = (r - uPupil) / (uOuter - uPupil); // 0 at pupil edge, 1 at limbus
  // radial fibres stretch with the pupil
  float fib = snoise(vec3(cos(a) * 18.0, sin(a) * 18.0, u * 2.5)) * 0.5 + snoise(vec3(cos(a) * 60.0, sin(a) * 60.0, u * 6.0)) * 0.35;
  float crypt = smoothstep(0.35, 0.75, snoise(vec3(cos(a) * 7.0, sin(a) * 7.0, u * 4.0 + 3.0))) * smoothstep(0.25, 0.4, u) * (1.0 - smoothstep(0.75, 0.9, u));
  vec3 col = uColor * (0.75 + 0.45 * fib);
  col = mix(col, uColor * 0.35, crypt * 0.6);
  // collarette
  float coll = exp(-pow((u - 0.32) / 0.05, 2.0));
  col = mix(col, uColor * 1.45 + vec3(0.08), coll * 0.45);
  // pupillary ruff and limbal ring
  col = mix(col, vec3(0.06, 0.03, 0.02), 1.0 - smoothstep(0.0, 0.06, u));
  col *= mix(1.0, 0.25, smoothstep(0.86, 1.0, u));
  col += vec3(0.6) * uShimmer * pow(max(0.0, snoise(vec3(a * 10.0, u * 8.0, uTime * 6.0))), 6.0);
  col += vec3(0.25, 0.22, 0.18) * uHighlight;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`,Pt=`
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vPos; varying vec3 vN; varying vec3 vView;
void main(){
  vPos = position;
  vN = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mvPosition.xyz);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`,St=`
#include <common>
#include <clipping_planes_pars_fragment>
${le}
uniform vec3 uKey; uniform vec3 uRim; uniform float uHighlight;
varying vec3 vPos; varying vec3 vN; varying vec3 vView;
void main(){
  #include <clipping_planes_fragment>
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 p = normalize(vPos);
  vec3 base = vec3(0.93, 0.89, 0.84);
  float front = smoothstep(0.1, 0.85, p.z);
  float v1 = pow(1.0 - abs(snoise(p * 5.0)), 16.0);
  float v2 = pow(1.0 - abs(snoise(p * 11.0 + 4.0)), 22.0);
  vec3 col = mix(base, vec3(0.78, 0.32, 0.28), (v1 * 0.32 + v2 * 0.22) * front);
  col = mix(col, vec3(0.86, 0.78, 0.7), (1.0 - front) * 0.35);
  float diff = max(dot(n, normalize(uKey)), 0.0);
  float rim = pow(1.0 - max(dot(n, vView), 0.0), 3.0);
  vec3 h = normalize(normalize(uKey) + vView);
  float spec = pow(max(dot(n, h), 0.0), 40.0);
  vec3 lit = col * (0.28 + 0.8 * diff) + vec3(0.6, 0.7, 0.9) * rim * 0.35 + vec3(1.0) * spec * 0.25;
  if (!gl_FrontFacing) lit = col * 0.35;
  lit += vec3(0.3, 0.28, 0.24) * uHighlight;
  gl_FragColor = vec4(lit, 1.0);
  #include <colorspace_fragment>
}
`,Jt={cornea:{name:"Cornea",line:"Clear front window. Does about two thirds of the focusing."},iris:{name:"Iris",line:"Coloured muscle ring that sets the pupil size."},pupil:{name:"Pupil",line:"The opening in the iris. Light and the fundus camera both pass through it."},lens:{name:"Lens",line:"Changes shape to focus near or far (accommodation)."},ciliary:{name:"Ciliary body",line:"Muscle that changes the lens shape and makes aqueous fluid."},vitreous:{name:"Vitreous",line:"Clear gel filling the eye behind the lens."},retina:{name:"Retina",line:"Light-sensitive layer. This is what a fundus photo shows."},macula:{name:"Macula / fovea",line:"Centre of sharp vision. Exudates near it matter most."},disc:{name:"Optic disc",line:"Where the nerve and vessels leave the eye. No photoreceptors: the blind spot."},choroid:{name:"Choroid",line:"Vascular layer that feeds the outer retina. Gives the fundus its red-orange."},sclera:{name:"Sclera",line:"Tough white outer coat."},nerve:{name:"Optic nerve",line:"Carries the signal to the brain. Leaves about 15° nasal of the fovea."}},_t={brown:"#5a3a22",hazel:"#7a5a2a",green:"#4f6a3a",blue:"#4a6e94",grey:"#6f7a80"},K=Math.PI/180,ue=32*K,Et=12*Math.sin(ue),Ft=12*Math.cos(ue),pe=7.8,Oe=Math.asin(Et/pe),jt=Ft-pe*Math.cos(Oe),Ce=9,Ot=8.75;function re(e,t,n=96){const o=new ie(e,n,Math.round(n*.66),0,Math.PI*2,t,Math.PI-t);return o.rotateX(Math.PI/2),o}function Tt(e=3.8,t=10.2,n=6,o=4.5){const s=[],r=t-Math.sqrt(t*t-o*o),c=n-Math.sqrt(n*n-o*o),h=Math.max(.2,e-r-c),d=24;for(let g=0;g<=d;g++){const M=o*g/d;s.push(new ae(Math.max(M,.001),-(t-Math.sqrt(t*t-M*M))))}s.push(new ae(o,-r-h));for(let g=d;g>=0;g--){const M=o*g/d;s.push(new ae(Math.max(M,.001),-e+(n-Math.sqrt(n*n-M*M))))}const f=new Ke(s,96);return f.rotateX(Math.PI/2),f}const z=(()=>{const e=new _e(new Uint8Array([0,0,0,0]),1,1);return e.needsUpdate=!0,e})();function Xt({eye:e="OD",pupilRef:t,pupil:n=1.5,shimmerRef:o,irisColor:s=_t.brown,explode:r=0,sectionX:c=null,retina:h,highlight:d=null,onHover:f,onRetinaClick:g,showVitreous:M=!0,hideFront:F=!1,only:v}){const p=u.useMemo(()=>wt(e),[e]),C=u.useMemo(()=>new Pe(new E(-1,0,0),100),[]),w=u.useMemo(()=>[C],[C]);u.useEffect(()=>{C.constant=c??1e3},[c,C]);const x=u.useMemo(()=>({sclera:re(12,ue),choroid:re(11.88,36*K),retina:re(11.75,40*K,128),vitreous:new ie(11.6,64,40),cornea:(()=>{const a=new ie(pe,96,32,0,Math.PI*2,0,Oe);return a.rotateX(Math.PI/2),a})(),iris:new Ze(.3,5.9,160,6),pupil:new Be(1,64),lens:Tt(),ciliary:new qe(5.7,.75,20,120),nerve:new de(1.5,1.7,16,48,1,!0),sheath:new de(2.1,2.3,15.5,48,1,!0)}),[]),i=u.useMemo(()=>{const a=new E(.6,.7,.9),m=new oe({vertexShader:Pt,fragmentShader:St,side:D,clipping:!0,uniforms:{uKey:{value:a},uRim:{value:new E(-.5,.2,-1)},uHighlight:{value:0}}}),y=new oe({vertexShader:yt,fragmentShader:Mt,side:D,clipping:!0,uniforms:{uFundus:{value:z},uHasFundus:{value:0},uCam:{value:z},uCamOn:{value:0},uAtt:{value:z},uAttOn:{value:0},uLes:{value:z},uLesOn:{value:0},uA:{value:new E(0,0,-1)},uEx:{value:new E(1,0,0)},uEy:{value:new E(0,-1,0)},uHalfFov:{value:22.5*K},uShowUnimaged:{value:1},uSel:{value:new E(0,0,-1)},uSelOn:{value:0},uTime:{value:0},uNerve:{value:new E(...p)},uHighlight:{value:0},uCapDirs:{value:[0,1,2,3].map(()=>new E(0,0,-1))},uCapHalf:{value:[0,0,0,0]},uCapColor:{value:new W("#64D2FF")},uCapOn:{value:0}}}),b=new oe({vertexShader:Ct,fragmentShader:bt,side:D,clipping:!0,uniforms:{uColor:{value:new W(s)},uPupil:{value:1.5},uOuter:{value:5.9},uTime:{value:0},uShimmer:{value:0},uHighlight:{value:0}}}),U=new se({transmission:1,ior:1.376,thickness:.55,roughness:.02,clearcoat:1,clearcoatRoughness:.03,metalness:0,color:"#ffffff",transparent:!0,opacity:1,side:ve,clippingPlanes:w,envMapIntensity:1.2,specularIntensity:1}),Le=new se({transmission:1,ior:1.42,thickness:3.8,roughness:.06,color:"#fff2cf",attenuationColor:new W("#ffe7a8"),attenuationDistance:12,clippingPlanes:w,side:ve,transparent:!0}),Ie=new Q({color:"#d9c48f",side:Se,clippingPlanes:w,transparent:!0,opacity:.85}),ke=new V({color:"#5a0f0c",roughness:.7,side:D,clippingPlanes:w}),Ne=new V({color:"#3a2016",roughness:.8,clippingPlanes:w}),Ve=new se({color:"#cfe8ff",transparent:!0,opacity:.035,roughness:.2,depthWrite:!1,side:D,clippingPlanes:w}),Ge=new Q({color:"#030202",side:D,clippingPlanes:w}),He=new V({color:"#e6d3a3",roughness:.6,side:D,clippingPlanes:w}),Ue=new V({color:"#efe6d8",transparent:!0,opacity:.35,roughness:.5,side:D,clippingPlanes:w,depthWrite:!1});for(const We of[m,y,b])We.clippingPlanes=w;return{sclera:m,retina:y,iris:b,cornea:U,lens:Le,lensCap:Ie,choroid:ke,ciliary:Ne,vitreous:Ve,pupil:Ge,nerve:He,sheath:Ue}},[w]);u.useEffect(()=>{i.iris.uniforms.uColor.value.set(s)},[s,i]),u.useEffect(()=>{i.retina.uniforms.uNerve.value.set(...p)},[p,i]),u.useEffect(()=>{const a=i.retina.uniforms,m=h??{};a.uHasFundus.value=m.fundus?1:0,a.uFundus.value=m.fundus??z,a.uCam.value=m.cam??z,a.uAtt.value=m.att??z,a.uLes.value=m.les??z,a.uCamOn.value=m.cam?m.camOn??0:0,a.uAttOn.value=m.att?m.attOn??0:0,a.uLesOn.value=m.les?m.lesOn??0:0,a.uShowUnimaged.value=m.showUnimaged===!1?0:1;const y=m.projection;if(y&&(a.uA.value.set(...y.A),a.uEx.value.set(...y.Ex),a.uEy.value.set(...y.Ey),a.uHalfFov.value=y.halfFov),a.uSelOn.value=m.selected?1:0,m.selected&&a.uSel.value.set(...m.selected),m.caps){a.uCapOn.value=1;for(let b=0;b<4;b++){const U=m.caps.dirs[b];a.uCapDirs.value[b].set(...U??q),a.uCapHalf.value[b]=m.caps.half[b]??0}a.uCapColor.value.set(m.caps.color??"#64D2FF")}else a.uCapOn.value=0},[h,i]),u.useEffect(()=>{const a=y=>d===y?1:0;i.sclera.uniforms.uHighlight.value=a("sclera"),i.iris.uniforms.uHighlight.value=a("iris"),i.retina.uniforms.uHighlight.value=a("retina")||a("macula")||a("disc")?.6:0;const m=(y,b,U="#ffffff")=>{y.emissive=new W(U),y.emissiveIntensity=b?.35:0};m(i.choroid,d==="choroid","#ff6a50"),m(i.ciliary,d==="ciliary","#ffb080"),m(i.nerve,d==="nerve","#ffe7a0"),i.vitreous.opacity=d==="vitreous"?.16:M?.035:0,i.lensCap.color.set(d==="lens"?"#fff0b8":"#d9c48f"),i.cornea.emissive=new W("#9fd8ff"),i.cornea.emissiveIntensity=d==="cornea"?.25:0,i.pupil.color.set(d==="pupil"?"#2a2a2a":"#030202")},[d,i,M]);const I=u.useRef(null);ut(a=>{const m=a.clock.elapsedTime,y=t?t.current:n;i.iris.uniforms.uPupil.value=y,i.iris.uniforms.uTime.value=m,i.iris.uniforms.uShimmer.value=o?o.current:0,i.retina.uniforms.uTime.value=m,I.current&&I.current.scale.setScalar(y)});const _=r,Z=u.useMemo(()=>new E(...p).multiplyScalar(12+7.4),[p]),P=u.useMemo(()=>new $e().setFromUnitVectors(new E(0,1,0),new E(...p)),[p]),A=a=>c!=null&&a.x>c,ne=A,O=(a,m=null)=>({onPointerMove:f?y=>{A(y.point)||m&&y.intersections.some(b=>b.object!==y.object&&!ne(b.point)&&(m==="all"||m.includes(b.object.name)))||(y.stopPropagation(),f(a,y.point))}:void 0,onPointerOut:f?()=>f(null):void 0}),ze={onPointerMove:f?a=>{if(A(a.point))return;a.stopPropagation();const m=a.object.worldToLocal(a.point.clone()),y=t?t.current:n;f(Math.hypot(m.x,m.y)<y?"pupil":"iris",a.point)}:void 0,onPointerOut:f?()=>f(null):void 0},fe=a=>{const y=a.object.worldToLocal(a.point.clone()).normalize(),b=[y.x,y.y,y.z];return Me(b,q)<7?{part:"macula",dir:b}:Me(b,p)<5?{part:"disc",dir:b}:{part:"retina",dir:b}},T=a=>!v||v.includes(a),$=!F;return l.jsxs("group",{children:[T("sclera")&&l.jsx("mesh",{geometry:x.sclera,material:i.sclera,position:[0,0,-9*_],...O("sclera"),renderOrder:1}),T("nerve")&&l.jsxs("group",{position:[0,0,-9*_],children:[l.jsx("mesh",{geometry:x.nerve,material:i.nerve,position:Z,quaternion:P,...O("nerve")}),l.jsx("mesh",{geometry:x.sheath,material:i.sheath,position:Z,quaternion:P})]}),T("choroid")&&l.jsx("mesh",{geometry:x.choroid,material:i.choroid,position:[0,0,-6*_],...O("choroid")}),T("retina")&&l.jsx("mesh",{geometry:x.retina,material:i.retina,position:[0,0,-3*_],onPointerMove:f?a=>{A(a.point)||(a.stopPropagation(),f(fe(a).part,a.point))}:void 0,onPointerOut:f?()=>f(null):void 0,onClick:g?a=>{a.stopPropagation(),g(fe(a).dir,a)}:void 0}),M&&T("vitreous")&&l.jsx("mesh",{geometry:x.vitreous,material:i.vitreous,...O("vitreous","all"),renderOrder:2}),$&&T("ciliary")&&l.jsx("mesh",{geometry:x.ciliary,material:i.ciliary,position:[0,0,7.7+6*_],...O("ciliary")}),$&&T("lens")&&l.jsxs("group",{position:[0,0,Ot+4.5*_],children:[l.jsx("mesh",{geometry:x.lens,material:i.lensCap}),l.jsx("mesh",{geometry:x.lens,material:i.lens,...O("lens"),renderOrder:3})]}),$&&T("iris")&&l.jsxs(l.Fragment,{children:[l.jsx("mesh",{ref:I,geometry:x.pupil,material:i.pupil,position:[0,0,Ce-.06+8*_],raycast:()=>null}),l.jsx("mesh",{name:"iris",geometry:x.iris,material:i.iris,position:[0,0,Ce+8*_],...ze})]}),$&&T("cornea")&&l.jsx("mesh",{geometry:x.cornea,material:i.cornea,position:[0,0,jt+12*_],...O("cornea",["iris"]),renderOrder:4})]})}class Rt extends Ee{constructor(){super();const t=new Qe;t.deleteAttribute("uv");const n=new V({side:Se}),o=new V,s=new Je(16777215,900,28,2);s.position.set(.418,16.199,.3),this.add(s);const r=new S(t,n);r.position.set(-.757,13.219,.717),r.scale.set(31.713,28.305,28.591),this.add(r);const c=new S(t,o);c.position.set(-10.906,2.009,1.846),c.rotation.set(0,-.195,0),c.scale.set(2.328,7.905,4.651),this.add(c);const h=new S(t,o);h.position.set(-5.607,-.754,-.758),h.rotation.set(0,.994,0),h.scale.set(1.97,1.534,3.955),this.add(h);const d=new S(t,o);d.position.set(6.167,.857,7.803),d.rotation.set(0,.561,0),d.scale.set(3.927,6.285,3.687),this.add(d);const f=new S(t,o);f.position.set(-2.017,.018,6.124),f.rotation.set(0,.333,0),f.scale.set(2.002,4.566,2.064),this.add(f);const g=new S(t,o);g.position.set(2.291,-.756,-2.621),g.rotation.set(0,-.286,0),g.scale.set(1.546,1.552,1.496),this.add(g);const M=new S(t,o);M.position.set(-2.193,-.369,-5.547),M.rotation.set(0,.516,0),M.scale.set(3.875,3.487,2.986),this.add(M);const F=new S(t,k(50));F.position.set(-16.116,14.37,8.208),F.scale.set(.1,2.428,2.739),this.add(F);const v=new S(t,k(50));v.position.set(-16.109,18.021,-8.207),v.scale.set(.1,2.425,2.751),this.add(v);const p=new S(t,k(17));p.position.set(14.904,12.198,-1.832),p.scale.set(.15,4.265,6.331),this.add(p);const C=new S(t,k(43));C.position.set(-.462,8.89,14.52),C.scale.set(4.38,5.441,.088),this.add(C);const w=new S(t,k(20));w.position.set(3.235,11.486,-12.541),w.scale.set(2.5,2,.1),this.add(w);const x=new S(t,k(100));x.position.set(0,20,0),x.scale.set(1,.1,1),this.add(x)}dispose(){const t=new Set;this.traverse(n=>{n.isMesh&&(t.add(n.geometry),t.add(n.material))});for(const n of t)n.dispose()}}function k(e){const t=new Q;return t.color.setScalar(e),t}const At=1.5,Te=64,ee=(e,t)=>{try{performance.measure(e,{start:t,end:performance.now()})}catch{}};let N=null;function Dt(){return N||(N=new Promise(e=>{if(typeof Worker>"u"||typeof OffscreenCanvas>"u"||/[?&]noenvworker\b/.test(location.search))return e(null);let t;try{t=new Worker(new URL("/assets/envWorker-CgJBevF6.js",import.meta.url),{type:"module"})}catch{return e(null)}const n=performance.now(),o=setTimeout(()=>{t.terminate(),e(null)},6e3);t.onmessage=s=>{clearTimeout(o),t.terminate(),ee("3d:env-worker",n),e(s.data.ok?s.data:null)},t.onerror=()=>{clearTimeout(o),t.terminate(),e(null)},t.postMessage({size:Te})}),N.then(e=>{e||(N=null)}),N)}function zt(e){var c;const t=performance.now(),n=new Rt,o=new at(Te,{type:ce});new rt(.1,100,o).update(e,n);const s=new it(e),r=s.fromCubemap(o.texture).texture;return s.dispose(),o.dispose(),(c=n.dispose)==null||c.call(n),ee("3d:env-main",t),r}const X=new WeakMap;function Re(e){let t=X.get(e);return t||(t=(te(e)?Dt():Promise.resolve(null)).then(n=>{if(!n)return zt(e);const o=new _e(n.data,n.width,n.height,nt,ce);return o.mapping=ot,o.minFilter=o.magFilter=st,o.generateMipmaps=!1,o.colorSpace=n.colorSpace,o.needsUpdate=!0,o}),X.set(e,t)),t}const Lt=e=>Re(e).then(()=>{},()=>{}),te=e=>e.extensions.has("KHR_parallel_shader_compile")&&!(typeof location<"u"&&/[?&]nogate\b/.test(location.search)),Ae=new WeakMap,be=new WeakMap;function me(e,t){const n=new Ee,o=new Q({colorWrite:!1,depthWrite:!1,depthTest:!1});t&&(o.clippingPlanes=Array.from({length:t},()=>new Pe(new E(0,0,1),1e9)));const s=new S(e,o);return s.frustumCulled=!1,n.add(s),n}function De(e){let t=be.get(e);if(!t){const n=new Ye;n.setAttribute("position",new et([0,0,0,1e-4,0,0,0,1e-4,0],3)),t={geo:n,plain:me(n,0),clip:new Map,rt:new tt(1,1,{type:ce})},be.set(e,t)}return t}const It=()=>new Promise(e=>setTimeout(e,0));async function kt(e,t,n,o,s){if(!te(e))return;const r=De(e),c=Ae.get(e)??!1,h=[];o.traverse(v=>{const p=v;if(!(p.isMesh||v.isLine||v.isPoints||v.isSprite)||!p.material)return;const C=Array.isArray(p.material)?p.material:[p.material],w=e.localClippingEnabled?Math.max(0,...C.map(x=>{var i;return((i=x.clippingPlanes)==null?void 0:i.length)??0})):0;c||h.push({o:v,planes:w,rt:!1}),h.push({o:v,planes:w,rt:!0})}),h.sort((v,p)=>v.planes-p.planes||Number(v.rt)-Number(p.rt));const d=v=>{if(!v)return r.plain;let p=r.clip.get(v);return p||r.clip.set(v,p=me(r.geo,v)),p},f=new Set,g=performance.now();let M=0;for(;M<h.length;){if(!s())return;const v=e.getRenderTarget(),p=e.autoClear;e.autoClear=!1;const C=performance.now();let w="";try{for(;M<h.length&&performance.now()-C<24;){const x=h[M++],i=`${x.planes}|${x.rt}`;i!==w&&(e.setRenderTarget(null),e.render(d(x.planes),n),e.setRenderTarget(x.rt?r.rt:null),w=i),e.compile(x.o,n,t).forEach(I=>f.add(I))}}finally{e.setRenderTarget(v),e.autoClear=p}await It()}ee("3d:compile-submit",g);const F=e.properties;await new Promise(v=>{const p=()=>{if(!s()||performance.now()-g>1e4)return v();for(const C of f){const w=F.get(C).programs;(!w||[...w.values()].every(x=>x.isReady()))&&f.delete(C)}f.size?setTimeout(p,16):v()};p()})}function Nt(){const{gl:e,camera:t}=Y();return u.useEffect(()=>{if(!te(e))return;const n=De(e),o=e.autoClear;e.autoClear=!1,e.setRenderTarget(null),e.render(n.plain,t),n.clip.has(1)||n.clip.set(1,me(n.geo,1)),e.render(n.clip.get(1),t),e.autoClear=o},[e,t]),null}function Vt({on:e}){const t=Y(n=>n.gl);return Ae.set(t,e),null}function Gt({children:e}){const{gl:t,scene:n,camera:o}=Y(),s=u.useRef(null),[r,c]=u.useState(()=>!te(t));return u.useEffect(()=>{if(r||!s.current)return;let h=!0;const d=s.current,f=performance.now(),g=requestAnimationFrame(()=>{Lt(t).then(()=>kt(t,n,o,d,()=>h)).then(()=>{h&&(ee("3d:ready",f),c(!0))})});return()=>{h=!1,cancelAnimationFrame(g)}},[]),l.jsx("group",{ref:s,visible:r,children:e})}function Ht({intensity:e=.6}){const{gl:t,scene:n}=Y();return u.useEffect(()=>{let o=!0;return Re(t).then(s=>{o&&(n.environment=s)}),()=>{o=!1,n.environment=null}},[t,n]),u.useEffect(()=>{n.environmentIntensity=e},[n,e]),u.useEffect(()=>()=>{var o;(o=X.get(t))==null||o.then(s=>s.dispose()),X.delete(t)},[t]),null}function Ut(){return l.jsxs(l.Fragment,{children:[l.jsx("ambientLight",{intensity:.35}),l.jsx("directionalLight",{position:[30,40,50],intensity:2.2}),l.jsx("directionalLight",{position:[-40,10,-40],intensity:1.2,color:"#9fc4ff"}),l.jsx("pointLight",{position:[0,0,-2],intensity:30,distance:30,color:"#ffb48a"})]})}function Wt(e=700){const[t,n]=u.useState(!1);return u.useEffect(()=>{let o=null,s=null;const r=requestAnimationFrame(()=>{typeof window.requestIdleCallback=="function"?o=window.requestIdleCallback(()=>n(!0),{timeout:e}):s=window.setTimeout(()=>n(!0),60)});return()=>{cancelAnimationFrame(r),o!=null&&window.cancelIdleCallback(o),s!=null&&window.clearTimeout(s)}},[e]),t}function qt(e){const[t,n]=u.useState(!0),[o,s]=u.useState(()=>typeof document>"u"||!document.hidden);return u.useEffect(()=>{const r=()=>s(!document.hidden);return document.addEventListener("visibilitychange",r),()=>document.removeEventListener("visibilitychange",r)},[]),u.useEffect(()=>{const r=e.current;if(!r||typeof IntersectionObserver>"u")return;const c=new IntersectionObserver(h=>n(h.some(d=>d.isIntersecting)),{threshold:.01});return c.observe(r),()=>c.disconnect()},[e]),t&&o}function Yt({children:e,camera:t={position:[0,0,60],fov:32},className:n="",bloom:o=.55,onCreated:s,effects:r=!1}){const c=he(P=>P.lowPower),h=he(P=>P.setLowPower),[d,f]=u.useState(Math.min(At,window.devicePixelRatio||1)),g=u.useRef(null),M=qt(g),[F,v]=u.useState(0),[p,C]=u.useState(!1),w=u.useRef(!1),x=u.useRef(!0);u.useEffect(()=>(x.current=!0,()=>{x.current=!1}),[]);const i=u.useCallback(P=>{ge(P),C(!1),v(A=>A+1)},[]),I=u.useCallback(P=>{const A=O=>{O.preventDefault(),!(!x.current||!P.isConnected)&&(ge("lost",{route:location.pathname}),C(!0))},ne=()=>{x.current&&(w.current||(w.current=!0,i("restored")))};P.addEventListener("webglcontextlost",A),P.addEventListener("webglcontextrestored",ne)},[i]),_=r&&!c,Z=Wt();return l.jsxs("div",{ref:g,className:/\b(absolute|fixed)\b/.test(n)?n:`relative ${n}`,children:[!p&&Z&&l.jsxs(pt,{dpr:c?1:d,frameloop:M?"always":"never",camera:{position:t.position,fov:t.fov??32,near:.1,far:1e3},gl:{antialias:!_,alpha:!0,powerPreference:"high-performance",stencil:!1},onCreated:P=>{P.gl.localClippingEnabled=!0,P.gl.setClearColor(0,1),P.gl.toneMapping=Xe,I(P.gl.domElement),s==null||s({camera:P.camera,gl:P.gl})},children:[l.jsx(Vt,{on:_}),l.jsx(Nt,{}),l.jsx(mt,{bounds:()=>[45,1e3],flipflops:2,onDecline:()=>{f(1),h(!0)}}),l.jsxs(u.Suspense,{fallback:null,children:[l.jsx(Ht,{}),l.jsx(Ut,{}),l.jsx(Gt,{children:e}),_&&l.jsxs(ft,{multisampling:0,enableNormalPass:!1,children:[l.jsx(dt,{intensity:o,luminanceThreshold:.75,luminanceSmoothing:.2,mipmapBlur:!0,radius:.55}),l.jsx(vt,{eskil:!1,offset:.25,darkness:.75})]})]})]},F),p&&l.jsx("div",{role:"alert",className:"absolute inset-0 z-20 grid place-items-center bg-black/80 p-6 text-center",children:l.jsxs("div",{className:"max-w-[320px]",children:[l.jsx("div",{className:"text-headline",children:"3D paused."}),l.jsx("p",{className:"mt-1 text-[14px] text-l2",children:"The graphics card reset the 3D view. The rest of the page still works."}),l.jsx("button",{type:"button",className:"btn-white mt-4",onClick:()=>i("restore-click"),children:"Restore 3D"})]})})]})}function en(e,t=!0){const[n,o]=u.useState(null);return u.useEffect(()=>{if(!e){o(null);return}let s=!0;return new ct().load(e,c=>{if(!s)return c.dispose();t&&(c.colorSpace=Fe),c.anisotropy=4,c.needsUpdate=!0,o(c)},void 0,()=>s&&o(null)),()=>{s=!1}},[e,t]),u.useEffect(()=>()=>n==null?void 0:n.dispose(),[n]),n}function tn(e){const t=new lt(e);return t.colorSpace=Fe,t.anisotropy=4,t}export{Gt as C,Xt as E,_t as I,q as P,Yt as S,Jt as a,Me as b,tn as c,ye as i,xt as m,wt as n,Qt as s,en as u};
