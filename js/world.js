// One WebGL scene: Salar's head as Gaussian splats, floating in front of a galaxy and a solar system.
// Scroll drives everything through world.update(progress, time, tilt).
import * as THREE from "three";

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const range = (p, a, b) => clamp((p - a) / (b - a));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const smooth = t => t * t * (3 - 2 * t);

/* ---------- tiny 3D value noise for the planet textures ---------- */
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0,0,0), c(1,0,0), xf), l(c(0,1,0), c(1,1,0), xf), yf), l(l(c(0,0,1), c(1,0,1), xf), l(c(0,1,1), c(1,1,1), xf), yf), zf);
}
const fbm = (x, y, z, o = 5) => { let v = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { v += a * noise(x * f, y * f, z * f); a *= .5; f *= 2.03; } return v; };

function sphereTexture(w, h, fn) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h), d = img.data;
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - j / h) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const lon = i / w * Math.PI * 2, x = cl * Math.cos(lon), z = cl * Math.sin(lon);
      const [r, g, b] = fn(x, sl, z, lat), k = (j * w + i) * 4;
      d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

const SURFACES = {
  sun: (x, y, z) => { const n = fbm(x * 6, y * 6, z * 6, 4); return mix([255, 120, 20], [255, 235, 160], n); },
  mercury: (x, y, z) => { const n = fbm(x * 5 + 3, y * 5, z * 5); return scale([150, 140, 132], .55 + n * .8); },
  venus: (x, y, z) => { const n = fbm(x * 2, y * 7, z * 2); return mix([200, 150, 80], [245, 220, 170], n); },
  earth: (x, y, z, lat) => {
    const n = fbm(x * 1.8 + 7, y * 1.8, z * 1.8);
    let c = n > .52 ? mix([60, 110, 45], [150, 125, 80], clamp((n - .52) * 5)) : mix([10, 35, 95], [25, 80, 150], n * 1.6);
    if (Math.abs(lat) > 1.22) c = [235, 240, 245];
    const cl = fbm(x * 3.5 + 20, y * 5, z * 3.5);
    return mix(c, [255, 255, 255], clamp((cl - .55) * 3) * .85);
  },
  moon: (x, y, z) => { const n = fbm(x * 4 + 9, y * 4, z * 4); return scale([180, 178, 172], .55 + n * .7); },
  mars: (x, y, z, lat) => {
    const n = fbm(x * 3 + 2, y * 3, z * 3);
    return Math.abs(lat) > 1.3 ? [240, 230, 225] : mix([110, 45, 25], [215, 110, 60], n);
  },
  jupiter: (x, y, z, lat) => {
    const b = Math.sin(lat * 16 + fbm(x * 3, y * 3, z * 3) * 3) * .5 + .5;
    let c = mix([150, 100, 70], [235, 215, 180], b);
    const sx = Math.atan2(z, x) - 1, sy = lat + .35;
    if (sx * sx / .09 + sy * sy / .012 < 1) c = [190, 80, 50];
    return c;
  },
  saturn: (x, y, z, lat) => { const b = Math.sin(lat * 14 + fbm(x * 2, y * 2, z * 2) * 2) * .5 + .5; return mix([190, 160, 105], [240, 220, 170], b); },
  uranus: (x, y, z) => mix([140, 205, 215], [175, 230, 235], fbm(x, y * 4, z)),
  neptune: (x, y, z, lat) => mix([40, 70, 190], [90, 140, 235], Math.sin(lat * 8 + fbm(x * 2, y * 2, z * 2) * 3) * .5 + .5),
};

function glowTexture(stops) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const g = cv.getContext("2d"), rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, c]) => rg.addColorStop(o, c));
  g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(cv);
}

/* ---------- splat shader ---------- */
const splatVert = /* glsl */`
attribute vec4 rgba; attribute float size; attribute float rnd;
uniform float uPix, uMax, uMin, uD, uE, uT, uFade;
uniform vec3 uPupil;
varying vec4 vC;
void main(){
  vec3 p = position;
  vec3 h = fract(vec3(rnd * 12.9898, rnd * 78.233, rnd * 37.719) * 43758.5453) - .5;
  p += h * uD * (.035 + .05 * rnd) + sin(uT * .0009 + rnd * 40.) * h * uD * .012;   // point-cloud drift
  vec3 dir = p - uPupil;
  p += dir * uE * (1.2 + 5. * rnd) + h * uE * 2.;                                     // burst through the pupil
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  float s = size * mix(1., .3, uD);
  gl_PointSize = min(s * uPix / max(-mv.z, 1e-4), mix(uMax, uMin * (.6 + rnd), uD));   // dissolves into fine points
  float keep = step(uD * .55, rnd);
  vec3 c = rgba.rgb;
  c = mix(c, c * 1.55 + vec3(.1, .03, .14), uD * .65);
  vC = vec4(c, rgba.a * keep * (1. - uFade));
}`;
const splatFrag = /* glsl */`
uniform float uD;
varying vec4 vC;
void main(){
  vec2 q = gl_PointCoord * 2. - 1.; float r2 = dot(q, q);
  if (r2 > 1.) discard;
  float a = vC.a * min(1., 1.25 * exp(-r2 * mix(2.2, 4.5, uD)));
  if (a < .004) discard;
  gl_FragColor = vec4(vC.rgb * a, a * (1. - uD * .85));   // premultiplied; drifts toward additive as it dissolves
}`;

export function createWorld({ canvas, splatBuffer, pupil, mobile }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
  const dpr = Math.min(devicePixelRatio, mobile ? 1.5 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x05040a, 0);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.0005, 500);
  const maxPoint = renderer.getContext().getParameter(renderer.getContext().ALIASED_POINT_SIZE_RANGE)[1];

  /* ----- head splats ----- */
  const dv = new DataView(splatBuffer), REC = 12, total = splatBuffer.byteLength / REC;
  const keepEvery = mobile ? 0.62 : 1;
  const pos = [], rgba = [], size = [], rnd = [];
  for (let i = 0; i < total; i++) {
    const r = (Math.sin(i * 91.7) * 43758.5453) % 1, rr = r < 0 ? r + 1 : r;
    if (rr > keepEvery) continue;
    const o = i * REC;
    pos.push(dv.getInt16(o, true) / 16000, dv.getInt16(o + 2, true) / 16000, dv.getInt16(o + 4, true) / 16000);
    rgba.push(dv.getUint8(o + 6), dv.getUint8(o + 7), dv.getUint8(o + 8), dv.getUint8(o + 9));
    size.push(dv.getUint8(o + 10) / 255 * 0.02 * (mobile ? 2.1 : 1.8));
    rnd.push(Math.random());
  }
  const n = size.length, P = new Float32Array(pos);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
  geo.setAttribute("rgba", new THREE.BufferAttribute(new Uint8Array(rgba), 4, true));
  geo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(size), 1));
  geo.setAttribute("rnd", new THREE.BufferAttribute(new Float32Array(rnd), 1));
  const index = new Uint32Array(n); for (let i = 0; i < n; i++) index[i] = i;
  const indexAttr = new THREE.BufferAttribute(index, 1); indexAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(indexAttr);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const pupilV = new THREE.Vector3(pupil.x, pupil.y, pupil.z);
  const splatMat = new THREE.ShaderMaterial({
    vertexShader: splatVert, fragmentShader: splatFrag, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uPix: { value: 1 }, uMax: { value: Math.min(maxPoint, 380 * dpr) }, uMin: { value: 5 * dpr }, uD: { value: 0 }, uE: { value: 0 }, uT: { value: 0 }, uFade: { value: 0 }, uPupil: { value: pupilV } },
  });
  const head = new THREE.Group();
  const splats = new THREE.Points(geo, splatMat); splats.renderOrder = 10; splats.frustumCulled = false;
  head.add(splats); scene.add(head);

  // back-to-front order for the current camera (bucket sort, only when the view changes)
  const NB = 2048, counts = new Uint32Array(NB), keys = new Uint16Array(n), camLocal = new THREE.Vector3(), last = new THREE.Vector3(1e9, 0, 0);
  function sortSplats() {
    camLocal.copy(cam.position); head.worldToLocal(camLocal);
    if (camLocal.distanceToSquared(last) < 1e-6 * Math.max(1e-3, camLocal.lengthSq())) return;
    last.copy(camLocal);
    let mn = Infinity, mx = -Infinity; const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dx = P[i*3] - camLocal.x, dy = P[i*3+1] - camLocal.y, dz = P[i*3+2] - camLocal.z;
      const v = dx*dx + dy*dy + dz*dz; d[i] = v; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    const k = (NB - 1) / Math.max(mx - mn, 1e-9); counts.fill(0);
    for (let i = 0; i < n; i++) { const b = NB - 1 - ((d[i] - mn) * k | 0); keys[i] = b; counts[b]++; }  // far first
    for (let b = 1; b < NB; b++) counts[b] += counts[b - 1];
    for (let i = n - 1; i >= 0; i--) index[--counts[keys[i]]] = i;
    indexAttr.needsUpdate = true;
  }

  /* ----- universe: galaxy, stars, solar system ----- */
  const C_END = new THREE.Vector3(pupil.x, pupil.y, -40);
  const O = new THREE.Vector3(pupil.x, pupil.y - 4.4, -52.8);
  const fades = [];   // [material, baseOpacity]
  const fadeable = (m, base = 1) => { m.transparent = true; fades.push([m, base]); return m; };

  const S = 4, gN = mobile ? 30000 : 70000;
  const gp = new Float32Array(gN * 3), gc = new Float32Array(gN * 3);
  const inside = new THREE.Color("#ffb08a"), midC = new THREE.Color("#ff4f1f"), outside = new THREE.Color("#5b3cff");
  for (let i = 0; i < gN; i++) {
    const r = Math.pow(Math.random(), 1.4) * 6, b = (i % 4) / 4 * Math.PI * 2, s = r * 1.15;
    const j = () => Math.pow(Math.random(), 3) * (Math.random() < .5 ? 1 : -1) * .5 * (r + .2);
    gp[i*3] = (Math.cos(b + s) * r + j()) * S; gp[i*3+1] = j() * .45 * S; gp[i*3+2] = (Math.sin(b + s) * r + j()) * S;
    const t = r / 6, c = t < .25 ? inside.clone().lerp(midC, t / .25) : midC.clone().lerp(outside, (t - .25) / .75);
    gc[i*3] = c.r; gc[i*3+1] = c.g; gc[i*3+2] = c.b;
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute("position", new THREE.BufferAttribute(gp, 3)); gg.setAttribute("color", new THREE.BufferAttribute(gc, 3));
  const galaxy = new THREE.Points(gg, fadeable(new THREE.PointsMaterial({ size: .011 * S, vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  const galaxyPivot = new THREE.Group(); galaxyPivot.position.copy(O); galaxyPivot.rotation.x = .38;
  galaxyPivot.add(galaxy); scene.add(galaxyPivot);

  const sN = mobile ? 4000 : 8000, sp = new Float32Array(sN * 3);
  for (let i = 0; i < sN; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 140);
    sp[i*3] = v.x + O.x; sp[i*3+1] = v.y + O.y; sp[i*3+2] = v.z + O.z * .6;
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, fadeable(new THREE.PointsMaterial({ size: .45, color: "#e4defc", depthWrite: false }), .85));
  scene.add(stars);

  // solar system (not to scale), oriented to face the final camera
  const solar = new THREE.Group(), plane = new THREE.Group(); solar.add(plane); scene.add(solar);
  plane.rotation.x = .42;
  const sunTex = sphereTexture(256, 128, SURFACES.sun);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(.62, 48, 32), fadeable(new THREE.MeshBasicMaterial({ map: sunTex })));
  plane.add(sun);
  const glow = new THREE.Sprite(fadeable(new THREE.SpriteMaterial({ map: glowTexture([[0, "rgba(255,230,170,1)"], [.18, "rgba(255,170,70,.75)"], [.45, "rgba(255,90,30,.18)"], [1, "rgba(255,60,20,0)"]]), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })));
  glow.scale.setScalar(4.4); plane.add(glow);
  const halo = new THREE.Sprite(fadeable(new THREE.SpriteMaterial({ map: glowTexture([[0, "rgba(255,120,60,.35)"], [1, "rgba(255,60,20,0)"]]), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }), .6));
  halo.scale.setScalar(12); plane.add(halo);
  plane.add(new THREE.PointLight(0xfff0dc, 3.2, 0, 0));
  scene.add(new THREE.AmbientLight(0x6060a0, .25));

  const PLANETS = [
    ["mercury", .07, 1.0], ["venus", .12, 1.35], ["earth", .13, 1.75], ["mars", .1, 2.15],
    ["jupiter", .32, 2.85], ["saturn", .26, 3.55], ["uranus", .17, 4.15], ["neptune", .165, 4.65],
  ];
  const bodies = [];
  PLANETS.forEach(([name, r, orbit], i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 24), fadeable(new THREE.MeshStandardMaterial({ map: sphereTexture(name === "earth" || name === "jupiter" ? 384 : 192, name === "earth" || name === "jupiter" ? 192 : 96, SURFACES[name]), roughness: 1, metalness: 0 })));
    m.rotation.z = .3;
    const holder = new THREE.Group(); holder.add(m); plane.add(holder);
    const body = { holder, mesh: m, orbit, speed: .00042 / Math.pow(orbit, 1.5), phase: i * 2.1 + .6 };
    if (name === "earth") {
      const moonPivot = new THREE.Group(); holder.add(moonPivot);
      const moon = new THREE.Mesh(new THREE.SphereGeometry(.036, 24, 16), fadeable(new THREE.MeshStandardMaterial({ map: sphereTexture(128, 64, SURFACES.moon), roughness: 1 })));
      moon.position.x = .26; moonPivot.add(moon); body.moonPivot = moonPivot;
    }
    if (name === "saturn") {
      const rg = new THREE.RingGeometry(r * 1.3, r * 2.25, 96, 1), uv = rg.attributes.uv, ps = rg.attributes.position;
      for (let k = 0; k < uv.count; k++) { const d = Math.hypot(ps.getX(k), ps.getY(k)); uv.setXY(k, (d - r * 1.3) / (r * .95), .5); }
      const cv = document.createElement("canvas"); cv.width = 256; cv.height = 1; const g = cv.getContext("2d");
      for (let x = 0; x < 256; x++) { const a = (.35 + .5 * fbm(x * .08, 0, 0, 3)) * (x > 150 && x < 165 ? .15 : 1); g.fillStyle = `rgba(225,205,160,${a})`; g.fillRect(x, 0, 1, 1); }
      const ring = new THREE.Mesh(rg, fadeable(new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), side: THREE.DoubleSide, roughness: 1, depthWrite: false })));
      ring.rotation.x = -Math.PI / 2 + .45; holder.add(ring);
    }
    const pts = []; for (let k = 0; k <= 128; k++) { const a = k / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * orbit, 0, Math.sin(a) * orbit)); }
    plane.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), fadeable(new THREE.LineBasicMaterial({ color: 0xffffff, depthWrite: false }), .1)));
    bodies.push(body);
  });

  let W = 1, H = 1, aspect = 1;
  function resize(w, h) {
    W = w; H = h; aspect = w / h;
    renderer.setSize(w, h, false); cam.aspect = aspect; cam.updateProjectionMatrix();
    // place the solar system in the final view: right of the headline on wide screens, below it on phones
    const fwd = O.clone().sub(C_END).normalize(), right = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3().crossVectors(right, fwd);
    const tall = aspect < .8, D = 9;
    const halfW = D * Math.tan(THREE.MathUtils.degToRad(30)) * aspect;
    const halfH = D * Math.tan(THREE.MathUtils.degToRad(29));
    const sx = tall ? 0 : halfW * .6, sy = tall ? -halfH * .6 : halfH * .42;   // upper right, clear of the headline
    solar.position.copy(C_END).addScaledVector(fwd, D).addScaledVector(right, sx).addScaledVector(up, sy);
    solar.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()));
    solar.scale.setScalar(tall ? Math.min(.5, halfW / 5) : 1);
  }

  const tgt = new THREE.Vector3(), look = new THREE.Vector3(), startCam = new THREE.Vector3();
  // p: scroll 0..1, t: ms, rot: {x,y} head rotation; returns pupil screen position for the captions
  function update(p, t, rot) {
    head.rotation.set(rot.x, rot.y, 0);
    const tan0 = Math.tan(THREE.MathUtils.degToRad(15));
    const D0 = Math.max(2.05 / (2 * tan0), 1.55 / (2 * tan0 * aspect));
    const wide = aspect > 1.15 ? -0.42 : 0, baseY = aspect < .8 ? -0.42 : 0.08;
    const dMin = pupil.r * (H / 2) / (tan0 * 0.9 * Math.max(W, H));
    const z = ease(range(p, 0.04, 0.55)), c = ease(range(p, 0.02, 0.42)), fly = smooth(range(p, 0.55, 1));

    tgt.set(lerp(0.05 + wide, pupil.x, c), lerp(baseY, pupil.y, c), lerp(0.15, pupil.z, c));
    const dist = (D0 + (0.15 - tgt.z)) * Math.exp(Math.log(dMin / D0) * z);
    startCam.set(tgt.x, tgt.y, tgt.z + dist);
    if (fly <= 0) { cam.position.copy(startCam); look.copy(tgt); }
    else {
      cam.position.copy(startCam).lerp(C_END, fly * fly * (1.6 - .6 * fly));
      look.set(tgt.x, tgt.y, tgt.z - 1).lerp(O, smooth(fly));
    }
    cam.fov = lerp(30, 58, ease(range(p, 0.58, 0.95)));
    cam.updateProjectionMatrix();
    cam.lookAt(look);
    cam.updateMatrixWorld();

    const u = splatMat.uniforms;
    u.uPix.value = (H * dpr / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    u.uD.value = smooth(range(p, 0.1, 0.34));
    u.uE.value = Math.pow(range(p, 0.46, 0.78), 1.6);
    u.uFade.value = range(p, 0.64, 0.8);
    u.uT.value = t;
    splats.visible = u.uFade.value < 1;

    const uni = range(p, 0.16, 0.45);
    fades.forEach(([m, base]) => { m.opacity = base * uni; });
    galaxyPivot.visible = stars.visible = solar.visible = uni > 0;
    renderer.setClearColor(0x05040a, smooth(range(p, 0.45, 0.7)));

    galaxy.rotation.y = t * 0.00004 + fly * 1.1;
    stars.rotation.y = t * 0.000006;
    sun.rotation.y = t * 0.00005;
    bodies.forEach(b => {
      const a = b.phase + t * b.speed + fly * b.speed * 9000;
      b.holder.position.set(Math.cos(a) * b.orbit, 0, Math.sin(a) * b.orbit);
      b.mesh.rotation.y = t * 0.0004;
      if (b.moonPivot) b.moonPivot.rotation.y = t * 0.0012;
    });

    if (splats.visible) sortSplats();
    renderer.render(scene, cam);
    const v = pupilV.clone(); head.localToWorld(v); v.project(cam);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
  }

  return { resize, update };
}
