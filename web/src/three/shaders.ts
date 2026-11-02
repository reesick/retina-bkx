// GLSL for the procedural eye. All procedural: no textures are fetched from the network.

export const NOISE = /* glsl */ `
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
`;

// ------------------------------------------------------------------ retina: fundus -> globe projection
export const RETINA_VERT = /* glsl */ `
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
`;

export const RETINA_FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
${NOISE}
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
`;

// ------------------------------------------------------------------ iris
export const IRIS_VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec2 vP;
void main(){
  vP = position.xy;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const IRIS_FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
${NOISE}
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
`;

// ------------------------------------------------------------------ sclera
export const SCLERA_VERT = /* glsl */ `
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
`;
export const SCLERA_FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
${NOISE}
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
`;
