import{a as p,j as l}from"./ui-1z3KOePw.js";import{o as De,c as E,ae as ce,af as ze,ag as Le,ah as Ie,ai as oe,u as X,D as z,h as q,aj as Y,a7 as le,ak as ne,a6 as ge,al as V,Q as Ae,d as ee,am as Te,an as Re,S as Ne,ao as Ve,ap as ke,x as _,A as He,aq as Ge,ab as Ue,ar as qe,as as Be,at as We,H as xe,au as Ze}from"./three-BkJhpqVu.js";import{u as Ke,C as $e,P as Qe,E as Je,B as Xe,V as Ye,a as et}from"./r3f-DMb_JfbV.js";import{u as ue,a9 as pe}from"./index-vrU1RJiw.js";const k=(t,e)=>t[0]*e[0]+t[1]*e[1]+t[2]*e[2],ye=(t,e)=>[t[1]*e[2]-t[2]*e[1],t[2]*e[0]-t[0]*e[2],t[0]*e[1]-t[1]*e[0]],F=(t,e)=>[t[0]*e,t[1]*e,t[2]*e],H=(t,e)=>[t[0]+e[0],t[1]+e[1],t[2]+e[2]],tt=t=>Math.hypot(t[0],t[1],t[2]),D=t=>F(t,1/(tt(t)||1));function me(t,e,o){const s=Math.cos(o),c=Math.sin(o);return H(H(F(t,s),F(ye(e,t),c)),F(e,k(e,t)*(1-s)))}const B=[0,0,-1],ve=15.5,W=Math.PI/180,I=.5,$=.5,ot=(t,e)=>[t,-e,0];function nt({fovea:t,disc:e,fovDeg:o},s=2.5){const c=o/2*W,u=[t.x-I,t.y-I],a=Math.hypot(u[0],u[1])/$*c;let h=B,m=[1,0,0],v=[0,-1,0];if(a>1e-9){const M=D(ot(u[0],u[1])),b=D(H(F(B,Math.cos(a)),F(M,-Math.sin(a)))),x=D(ye(B,b));h=b,m=me(m,x,a),v=me(v,x,a)}const f={A:h,Ex:m,Ey:v,halfFov:c,thetaScale:1,scaled:!1,discFoveaDegRaw:NaN,fovDeg:o};if(!e)return f;const g=de(f,e.x,e.y),O=de(f,t.x,t.y),P=Math.acos(Math.max(-1,Math.min(1,k(g,O))))/W;if(f.discFoveaDegRaw=P,P>1&&Math.abs(P-ve)>s){const M=ve/P;return{...nt({fovea:t,disc:null,fovDeg:o*M}),thetaScale:M,scaled:!0,discFoveaDegRaw:P,fovDeg:o}}return f}function de(t,e,o){const s=e-I,c=o-I,u=Math.hypot(s,c);if(u<1e-12)return t.A;const a=u/$*t.halfFov,h=D(H(F(t.Ex,s/u),F(t.Ey,c/u)));return D(H(F(t.A,Math.cos(a)),F(h,Math.sin(a))))}function Ft(t,e){const o=D(e),s=Math.max(-1,Math.min(1,k(o,t.A))),c=Math.acos(s),u=H(o,F(t.A,-s)),a=k(u,t.Ex),h=k(u,t.Ey),m=Math.hypot(a,h)||1,v=c/t.halfFov*$,f=I+v*a/m,g=I+v*h/m;return{x:f,y:g,inside:c<=t.halfFov&&Math.hypot(f-I,g-I)<=$,theta:c}}function st(t,e=15.5,o=1.5){const s=t==="OD"?1:-1,c=e*W,u=o*W;return D([s*Math.sin(c),Math.sin(u),-Math.cos(c)*Math.cos(u)])}function fe(t,e){return Math.acos(Math.max(-1,Math.min(1,k(D(t),D(e)))))/W}const se=`
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
`,at=`
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
`,it=`
#include <common>
#include <clipping_planes_pars_fragment>
${se}
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
`,rt=`
#include <common>
#include <clipping_planes_pars_vertex>
varying vec2 vP;
void main(){
  vP = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`,ct=`
#include <common>
#include <clipping_planes_pars_fragment>
${se}
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
`,lt=`
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
`,ut=`
#include <common>
#include <clipping_planes_pars_fragment>
${se}
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
`,Ot={cornea:{name:"Cornea",line:"Clear front window. Does about two thirds of the focusing."},iris:{name:"Iris",line:"Coloured muscle ring that sets the pupil size."},pupil:{name:"Pupil",line:"The opening in the iris. Light and the fundus camera both pass through it."},lens:{name:"Lens",line:"Changes shape to focus near or far (accommodation)."},ciliary:{name:"Ciliary body",line:"Muscle that changes the lens shape and makes aqueous fluid."},vitreous:{name:"Vitreous",line:"Clear gel filling the eye behind the lens."},retina:{name:"Retina",line:"Light-sensitive layer. This is what a fundus photo shows."},macula:{name:"Macula / fovea",line:"Centre of sharp vision. Exudates near it matter most."},disc:{name:"Optic disc",line:"Where the nerve and vessels leave the eye. No photoreceptors: the blind spot."},choroid:{name:"Choroid",line:"Vascular layer that feeds the outer retina. Gives the fundus its red-orange."},sclera:{name:"Sclera",line:"Tough white outer coat."},nerve:{name:"Optic nerve",line:"Carries the signal to the brain. Leaves about 15° nasal of the fovea."}},pt={brown:"#5a3a22",hazel:"#7a5a2a",green:"#4f6a3a",blue:"#4a6e94",grey:"#6f7a80"},K=Math.PI/180,ae=32*K,mt=12*Math.sin(ae),vt=12*Math.cos(ae),ie=7.8,we=Math.asin(mt/ie),dt=vt-ie*Math.cos(we),he=9,ft=8.75;function te(t,e,o=96){const s=new oe(t,o,Math.round(o*.66),0,Math.PI*2,e,Math.PI-e);return s.rotateX(Math.PI/2),s}function ht(t=3.8,e=10.2,o=6,s=4.5){const c=[],u=e-Math.sqrt(e*e-s*s),a=o-Math.sqrt(o*o-s*s),h=Math.max(.2,t-u-a),m=24;for(let f=0;f<=m;f++){const g=s*f/m;c.push(new ee(Math.max(g,.001),-(e-Math.sqrt(e*e-g*g))))}c.push(new ee(s,-u-h));for(let f=m;f>=0;f--){const g=s*f/m;c.push(new ee(Math.max(g,.001),-t+(o-Math.sqrt(o*o-g*g))))}const v=new Te(c,96);return v.rotateX(Math.PI/2),v}const L=(()=>{const t=new Re(new Uint8Array([0,0,0,0]),1,1);return t.needsUpdate=!0,t})();function jt({eye:t="OD",pupilRef:e,pupil:o=1.5,shimmerRef:s,irisColor:c=pt.brown,explode:u=0,sectionX:a=null,retina:h,highlight:m=null,onHover:v,onRetinaClick:f,showVitreous:g=!0,hideFront:O=!1,only:P}){const M=p.useMemo(()=>st(t),[t]),b=p.useMemo(()=>new De(new E(-1,0,0),100),[]),x=p.useMemo(()=>[b],[b]);p.useEffect(()=>{b.constant=a??1e3},[a,b]);const y=p.useMemo(()=>({sclera:te(12,ae),choroid:te(11.88,36*K),retina:te(11.75,40*K,128),vitreous:new oe(11.6,64,40),cornea:(()=>{const n=new oe(ie,96,32,0,Math.PI*2,0,we);return n.rotateX(Math.PI/2),n})(),iris:new Ie(.3,5.9,160,6),pupil:new Le(1,64),lens:ht(),ciliary:new ze(5.7,.75,20,120),nerve:new ce(1.5,1.7,16,48,1,!0),sheath:new ce(2.1,2.3,15.5,48,1,!0)}),[]),i=p.useMemo(()=>{const n=new E(.6,.7,.9),r=new X({vertexShader:lt,fragmentShader:ut,side:z,clipping:!0,uniforms:{uKey:{value:n},uRim:{value:new E(-.5,.2,-1)},uHighlight:{value:0}}}),d=new X({vertexShader:at,fragmentShader:it,side:z,clipping:!0,uniforms:{uFundus:{value:L},uHasFundus:{value:0},uCam:{value:L},uCamOn:{value:0},uAtt:{value:L},uAttOn:{value:0},uLes:{value:L},uLesOn:{value:0},uA:{value:new E(0,0,-1)},uEx:{value:new E(1,0,0)},uEy:{value:new E(0,-1,0)},uHalfFov:{value:22.5*K},uShowUnimaged:{value:1},uSel:{value:new E(0,0,-1)},uSelOn:{value:0},uTime:{value:0},uNerve:{value:new E(...M)},uHighlight:{value:0},uCapDirs:{value:[0,1,2,3].map(()=>new E(0,0,-1))},uCapHalf:{value:[0,0,0,0]},uCapColor:{value:new q("#64D2FF")},uCapOn:{value:0}}}),w=new X({vertexShader:rt,fragmentShader:ct,side:z,clipping:!0,uniforms:{uColor:{value:new q(c)},uPupil:{value:1.5},uOuter:{value:5.9},uTime:{value:0},uShimmer:{value:0},uHighlight:{value:0}}}),U=new Y({transmission:1,ior:1.376,thickness:.55,roughness:.02,clearcoat:1,clearcoatRoughness:.03,metalness:0,color:"#ffffff",transparent:!0,opacity:1,side:le,clippingPlanes:x,envMapIntensity:1.2,specularIntensity:1}),Ce=new Y({transmission:1,ior:1.42,thickness:3.8,roughness:.06,color:"#fff2cf",attenuationColor:new q("#ffe7a8"),attenuationDistance:12,clippingPlanes:x,side:le,transparent:!0}),be=new ne({color:"#d9c48f",side:ge,clippingPlanes:x,transparent:!0,opacity:.85}),Pe=new V({color:"#5a0f0c",roughness:.7,side:z,clippingPlanes:x}),_e=new V({color:"#3a2016",roughness:.8,clippingPlanes:x}),Se=new Y({color:"#cfe8ff",transparent:!0,opacity:.035,roughness:.2,depthWrite:!1,side:z,clippingPlanes:x}),Ee=new ne({color:"#030202",side:z,clippingPlanes:x}),Fe=new V({color:"#e6d3a3",roughness:.6,side:z,clippingPlanes:x}),Oe=new V({color:"#efe6d8",transparent:!0,opacity:.35,roughness:.5,side:z,clippingPlanes:x,depthWrite:!1});for(const je of[r,d,w])je.clippingPlanes=x;return{sclera:r,retina:d,iris:w,cornea:U,lens:Ce,lensCap:be,choroid:Pe,ciliary:_e,vitreous:Se,pupil:Ee,nerve:Fe,sheath:Oe}},[x]);p.useEffect(()=>{i.iris.uniforms.uColor.value.set(c)},[c,i]),p.useEffect(()=>{i.retina.uniforms.uNerve.value.set(...M)},[M,i]),p.useEffect(()=>{const n=i.retina.uniforms,r=h??{};n.uHasFundus.value=r.fundus?1:0,n.uFundus.value=r.fundus??L,n.uCam.value=r.cam??L,n.uAtt.value=r.att??L,n.uLes.value=r.les??L,n.uCamOn.value=r.cam?r.camOn??0:0,n.uAttOn.value=r.att?r.attOn??0:0,n.uLesOn.value=r.les?r.lesOn??0:0,n.uShowUnimaged.value=r.showUnimaged===!1?0:1;const d=r.projection;if(d&&(n.uA.value.set(...d.A),n.uEx.value.set(...d.Ex),n.uEy.value.set(...d.Ey),n.uHalfFov.value=d.halfFov),n.uSelOn.value=r.selected?1:0,r.selected&&n.uSel.value.set(...r.selected),r.caps){n.uCapOn.value=1;for(let w=0;w<4;w++){const U=r.caps.dirs[w];n.uCapDirs.value[w].set(...U??B),n.uCapHalf.value[w]=r.caps.half[w]??0}n.uCapColor.value.set(r.caps.color??"#64D2FF")}else n.uCapOn.value=0},[h,i]),p.useEffect(()=>{const n=d=>m===d?1:0;i.sclera.uniforms.uHighlight.value=n("sclera"),i.iris.uniforms.uHighlight.value=n("iris"),i.retina.uniforms.uHighlight.value=n("retina")||n("macula")||n("disc")?.6:0;const r=(d,w,U="#ffffff")=>{d.emissive=new q(U),d.emissiveIntensity=w?.35:0};r(i.choroid,m==="choroid","#ff6a50"),r(i.ciliary,m==="ciliary","#ffb080"),r(i.nerve,m==="nerve","#ffe7a0"),i.vitreous.opacity=m==="vitreous"?.16:g?.035:0,i.lensCap.color.set(m==="lens"?"#fff0b8":"#d9c48f"),i.cornea.emissive=new q("#9fd8ff"),i.cornea.emissiveIntensity=m==="cornea"?.25:0,i.pupil.color.set(m==="pupil"?"#2a2a2a":"#030202")},[m,i,g]);const G=p.useRef(null);Ke(n=>{const r=n.clock.elapsedTime,d=e?e.current:o;i.iris.uniforms.uPupil.value=d,i.iris.uniforms.uTime.value=r,i.iris.uniforms.uShimmer.value=s?s.current:0,i.retina.uniforms.uTime.value=r,G.current&&G.current.scale.setScalar(d)});const S=u,C=p.useMemo(()=>new E(...M).multiplyScalar(12+7.4),[M]),T=p.useMemo(()=>new Ae().setFromUnitVectors(new E(0,1,0),new E(...M)),[M]),R=n=>a!=null&&n.x>a,J=R,A=(n,r=null)=>({onPointerMove:v?d=>{R(d.point)||r&&d.intersections.some(w=>w.object!==d.object&&!J(w.point)&&(r==="all"||r.includes(w.object.name)))||(d.stopPropagation(),v(n,d.point))}:void 0,onPointerOut:v?()=>v(null):void 0}),Me={onPointerMove:v?n=>{if(R(n.point))return;n.stopPropagation();const r=n.object.worldToLocal(n.point.clone()),d=e?e.current:o;v(Math.hypot(r.x,r.y)<d?"pupil":"iris",n.point)}:void 0,onPointerOut:v?()=>v(null):void 0},re=n=>{const d=n.object.worldToLocal(n.point.clone()).normalize(),w=[d.x,d.y,d.z];return fe(w,B)<7?{part:"macula",dir:w}:fe(w,M)<5?{part:"disc",dir:w}:{part:"retina",dir:w}},j=n=>!P||P.includes(n),Z=!O;return l.jsxs("group",{children:[j("sclera")&&l.jsx("mesh",{geometry:y.sclera,material:i.sclera,position:[0,0,-9*S],...A("sclera"),renderOrder:1}),j("nerve")&&l.jsxs("group",{position:[0,0,-9*S],children:[l.jsx("mesh",{geometry:y.nerve,material:i.nerve,position:C,quaternion:T,...A("nerve")}),l.jsx("mesh",{geometry:y.sheath,material:i.sheath,position:C,quaternion:T})]}),j("choroid")&&l.jsx("mesh",{geometry:y.choroid,material:i.choroid,position:[0,0,-6*S],...A("choroid")}),j("retina")&&l.jsx("mesh",{geometry:y.retina,material:i.retina,position:[0,0,-3*S],onPointerMove:v?n=>{R(n.point)||(n.stopPropagation(),v(re(n).part,n.point))}:void 0,onPointerOut:v?()=>v(null):void 0,onClick:f?n=>{n.stopPropagation(),f(re(n).dir,n)}:void 0}),g&&j("vitreous")&&l.jsx("mesh",{geometry:y.vitreous,material:i.vitreous,...A("vitreous","all"),renderOrder:2}),Z&&j("ciliary")&&l.jsx("mesh",{geometry:y.ciliary,material:i.ciliary,position:[0,0,7.7+6*S],...A("ciliary")}),Z&&j("lens")&&l.jsxs("group",{position:[0,0,ft+4.5*S],children:[l.jsx("mesh",{geometry:y.lens,material:i.lensCap}),l.jsx("mesh",{geometry:y.lens,material:i.lens,...A("lens"),renderOrder:3})]}),Z&&j("iris")&&l.jsxs(l.Fragment,{children:[l.jsx("mesh",{ref:G,geometry:y.pupil,material:i.pupil,position:[0,0,he-.06+8*S],raycast:()=>null}),l.jsx("mesh",{name:"iris",geometry:y.iris,material:i.iris,position:[0,0,he+8*S],...Me})]}),Z&&j("cornea")&&l.jsx("mesh",{geometry:y.cornea,material:i.cornea,position:[0,0,dt+12*S],...A("cornea",["iris"]),renderOrder:4})]})}class gt extends Ne{constructor(){super();const e=new Ve;e.deleteAttribute("uv");const o=new V({side:ge}),s=new V,c=new ke(16777215,900,28,2);c.position.set(.418,16.199,.3),this.add(c);const u=new _(e,o);u.position.set(-.757,13.219,.717),u.scale.set(31.713,28.305,28.591),this.add(u);const a=new _(e,s);a.position.set(-10.906,2.009,1.846),a.rotation.set(0,-.195,0),a.scale.set(2.328,7.905,4.651),this.add(a);const h=new _(e,s);h.position.set(-5.607,-.754,-.758),h.rotation.set(0,.994,0),h.scale.set(1.97,1.534,3.955),this.add(h);const m=new _(e,s);m.position.set(6.167,.857,7.803),m.rotation.set(0,.561,0),m.scale.set(3.927,6.285,3.687),this.add(m);const v=new _(e,s);v.position.set(-2.017,.018,6.124),v.rotation.set(0,.333,0),v.scale.set(2.002,4.566,2.064),this.add(v);const f=new _(e,s);f.position.set(2.291,-.756,-2.621),f.rotation.set(0,-.286,0),f.scale.set(1.546,1.552,1.496),this.add(f);const g=new _(e,s);g.position.set(-2.193,-.369,-5.547),g.rotation.set(0,.516,0),g.scale.set(3.875,3.487,2.986),this.add(g);const O=new _(e,N(50));O.position.set(-16.116,14.37,8.208),O.scale.set(.1,2.428,2.739),this.add(O);const P=new _(e,N(50));P.position.set(-16.109,18.021,-8.207),P.scale.set(.1,2.425,2.751),this.add(P);const M=new _(e,N(17));M.position.set(14.904,12.198,-1.832),M.scale.set(.15,4.265,6.331),this.add(M);const b=new _(e,N(43));b.position.set(-.462,8.89,14.52),b.scale.set(4.38,5.441,.088),this.add(b);const x=new _(e,N(20));x.position.set(3.235,11.486,-12.541),x.scale.set(2.5,2,.1),this.add(x);const y=new _(e,N(100));y.position.set(0,20,0),y.scale.set(1,.1,1),this.add(y)}dispose(){const e=new Set;this.traverse(o=>{o.isMesh&&(e.add(o.geometry),e.add(o.material))});for(const o of e)o.dispose()}}function N(t){const e=new ne;return e.color.setScalar(t),e}const xt=1.5,yt=64,Q=new WeakMap;function wt(t){var h;const e=Q.get(t);if(e)return e;const o=new gt,s=new Ge(yt,{type:Ue});new qe(.1,100,s).update(t,o);const u=new Be(t),a=u.fromCubemap(s.texture).texture;return u.dispose(),s.dispose(),(h=o.dispose)==null||h.call(o),Q.set(t,a),a}function Mt({intensity:t=.6}){const{gl:e,scene:o}=et();return p.useEffect(()=>(o.environment=wt(e),()=>{o.environment=null}),[e,o]),p.useEffect(()=>{o.environmentIntensity=t},[o,t]),p.useEffect(()=>()=>{var s;(s=Q.get(e))==null||s.dispose(),Q.delete(e)},[e]),null}function Ct(){return l.jsxs(l.Fragment,{children:[l.jsx("ambientLight",{intensity:.35}),l.jsx("directionalLight",{position:[30,40,50],intensity:2.2}),l.jsx("directionalLight",{position:[-40,10,-40],intensity:1.2,color:"#9fc4ff"}),l.jsx("pointLight",{position:[0,0,-2],intensity:30,distance:30,color:"#ffb48a"})]})}function bt(t){const[e,o]=p.useState(!0),[s,c]=p.useState(()=>typeof document>"u"||!document.hidden);return p.useEffect(()=>{const u=()=>c(!document.hidden);return document.addEventListener("visibilitychange",u),()=>document.removeEventListener("visibilitychange",u)},[]),p.useEffect(()=>{const u=t.current;if(!u||typeof IntersectionObserver>"u")return;const a=new IntersectionObserver(h=>o(h.some(m=>m.isIntersecting)),{threshold:.01});return a.observe(u),()=>a.disconnect()},[t]),e&&s}function Dt({children:t,camera:e={position:[0,0,60],fov:32},className:o="",bloom:s=.55,onCreated:c,effects:u=!1}){const a=ue(C=>C.lowPower),h=ue(C=>C.setLowPower),[m,v]=p.useState(Math.min(xt,window.devicePixelRatio||1)),f=p.useRef(null),g=bt(f),[O,P]=p.useState(0),[M,b]=p.useState(!1),x=p.useRef(!1),y=p.useRef(!0);p.useEffect(()=>(y.current=!0,()=>{y.current=!1}),[]);const i=p.useCallback(C=>{pe(C),b(!1),P(T=>T+1)},[]),G=p.useCallback(C=>{const T=J=>{J.preventDefault(),!(!y.current||!C.isConnected)&&(pe("lost",{route:location.pathname}),b(!0))},R=()=>{y.current&&(x.current||(x.current=!0,i("restored")))};C.addEventListener("webglcontextlost",T),C.addEventListener("webglcontextrestored",R)},[i]),S=u&&!a;return l.jsxs("div",{ref:f,className:/\b(absolute|fixed)\b/.test(o)?o:`relative ${o}`,children:[!M&&l.jsxs($e,{dpr:a?1:m,frameloop:g?"always":"never",camera:{position:e.position,fov:e.fov??32,near:.1,far:1e3},gl:{antialias:!S,alpha:!0,powerPreference:"high-performance",stencil:!1},onCreated:C=>{C.gl.localClippingEnabled=!0,C.gl.setClearColor(0,1),C.gl.toneMapping=He,G(C.gl.domElement),c==null||c({camera:C.camera,gl:C.gl})},children:[l.jsx(Qe,{bounds:()=>[45,1e3],flipflops:2,onDecline:()=>{v(1),h(!0)}}),l.jsxs(p.Suspense,{fallback:null,children:[l.jsx(Mt,{}),l.jsx(Ct,{}),t,S&&l.jsxs(Je,{multisampling:0,enableNormalPass:!1,children:[l.jsx(Xe,{intensity:s,luminanceThreshold:.75,luminanceSmoothing:.2,mipmapBlur:!0,radius:.55}),l.jsx(Ye,{eskil:!1,offset:.25,darkness:.75})]})]})]},O),M&&l.jsx("div",{role:"alert",className:"absolute inset-0 z-20 grid place-items-center bg-black/80 p-6 text-center",children:l.jsxs("div",{className:"max-w-[320px]",children:[l.jsx("div",{className:"text-headline",children:"3D paused."}),l.jsx("p",{className:"mt-1 text-[14px] text-l2",children:"The graphics card reset the 3D view. The rest of the page still works."}),l.jsx("button",{type:"button",className:"btn-white mt-4",onClick:()=>i("restore-click"),children:"Restore 3D"})]})})]})}function zt(t,e=!0){const[o,s]=p.useState(null);return p.useEffect(()=>{if(!t){s(null);return}let c=!0;return new We().load(t,a=>{if(!c)return a.dispose();e&&(a.colorSpace=xe),a.anisotropy=4,a.needsUpdate=!0,s(a)},void 0,()=>c&&s(null)),()=>{c=!1}},[t,e]),p.useEffect(()=>()=>o==null?void 0:o.dispose(),[o]),o}function Lt(t){const e=new Ze(t);return e.colorSpace=xe,e.anisotropy=4,e}export{jt as E,pt as I,B as P,Dt as S,Ot as a,fe as b,Lt as c,de as i,nt as m,st as n,Ft as s,zt as u};
