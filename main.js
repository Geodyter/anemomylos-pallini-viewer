import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const $ = (id) => document.getElementById(id);
const EYE = 1.7, WALK = 2.2, RUN = 5.8;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 6000);
scene.add(camera);

// ήλιος: πίσω και πλάγια από τη θέση εκκίνησης (εκκίνηση στο +z, κοιτάει προς τον πύργο στο −z) ώστε να φωτίζεται η μπροστινή όψη
const el = THREE.MathUtils.degToRad(38), az = THREE.MathUtils.degToRad(35);
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();

// IBL + φόντο από το HDRI Poly Haven syferfontein_1d_clear_puresky (2K, CC0): viewer/env/syferfontein_1d_clear_puresky_2k.hdr
const pmrem = new THREE.PMREMGenerator(renderer);
new RGBELoader().load('env/syferfontein_1d_clear_puresky_2k.hdr', (tex) => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  scene.environmentIntensity = 1.0;
  scene.background = tex;
  // ομίχλη = χρώμα ορίζοντα του HDRI (μέσος όρος γύρω από τον ισημερινό), ώστε η άκρη της σκηνής να σβήνει στον ορίζοντα
  const { data, width: w, height: h } = tex.image;
  const c = new THREE.Color(0, 0, 0); let n = 0;
  for (let y = Math.floor(h / 2) - 4; y <= Math.floor(h / 2) + 1; y++) for (let x = 0; x < w; x += 4) {
    const i = (y * w + x) * 4;
    const f = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (v) => v;
    c.r += f(data[i]); c.g += f(data[i + 1]); c.b += f(data[i + 2]); n++;
  }
  scene.fog.color.setRGB(c.r / n, c.g / n, c.b / n);
  scene.backgroundIntensity = 1.0;
});

scene.fog = new THREE.Fog(new THREE.Color(0xb7c3cf), 120, 1250);   // τέλος ομίχλης πριν την άκρη των λόφων (±1300 m)

const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbcd2f0, 0x8a7656, 0.8));

// ---------- loaders (meshopt + KTX2) ----------
const ktx2 = new KTX2Loader().setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/').detectSupport(renderer);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
const load = (url, onProgress) => new Promise((res, rej) => loader.load(url, res, onProgress, rej));

// ---------- κατάσταση ----------
const controls = new PointerLockControls(camera, renderer.domElement);
const keys = {};
let sceneRoot = null, todayRoot = null, historicNodes = [], groundMeshes = [], towerR = 3.1, mode = 'historic', models = null;
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);

function groundY(x, z, fallback) {
  ray.set(new THREE.Vector3(x, 400, z), down);
  const hits = ray.intersectObjects(groundMeshes, false);
  return hits.length ? hits[0].point.y : fallback;
}

const setMsg = (t, s = '') => { $('txt').textContent = t; $('sub').textContent = s; };

async function init() {
  // τοπικά: /api/models (serve.py)· στατικά (GitHub Pages): models.json με σχετικές διαδρομές
  let base = '/';
  if (!location.pathname.startsWith('/viewer/')) { base = ''; models = await (await fetch('models.json')).json(); } else try { const r = await fetch('/api/models'); if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw 0; models = await r.json(); }
  catch { base = ''; models = await (await fetch('models.json')).json(); }
  if (!models.scene) { setMsg('Δεν βρέθηκε output/windmill_v*_webgl.glb', 'Τρέξε πρώτα το scripts/export_variants.py -- webgl'); return; }
  const gltf = await load(base + models.scene, (e) => {
    if (e.total) $('bar').firstElementChild.style.width = (100 * e.loaded / e.total).toFixed(0) + '%';
    const pc = e.total ? ' · ' + (100 * e.loaded / e.total).toFixed(0) + '%' : '';
    setMsg('Φόρτωση ' + models.scene.split('/').pop() + pc, (e.loaded / 1e6).toFixed(1) + (e.total ? ' / ' + (e.total / 1e6).toFixed(1) : '') + ' MB');
  });
  sceneRoot = gltf.scene;
  scene.add(sceneRoot);
  sceneRoot.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => {
        if (m.map) m.map.anisotropy = 4;
        if (m.alphaTest > 0) {            // φύλλα/χόρτα: alpha test + alpha-to-coverage (MSAA), διπλής όψης
          m.transparent = false; m.depthWrite = true; m.alphaToCoverage = true; m.side = THREE.DoubleSide;
          // κρατά την κάλυψη του alpha στα μακρινά mip (αλλιώς τα φύλλα εξαφανίζονται με cutoff 0.5)
          m.onBeforeCompile = (sh) => {
            sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
            #ifdef USE_MAP
              { vec2 ts = vec2(textureSize(map, 0)); vec2 dx = dFdx(vMapUv * ts), dy = dFdy(vMapUv * ts);
                float lod = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1.0));
                diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 0.2 * lod)); }
            #endif`);
          };
          m.needsUpdate = true;
        }
      });
    }
    if (/^(Tower_HD|Tower_Bands_HD|Door_Lintel_HD|Wind_)/.test(o.name)) historicNodes.push(o);
    if (o.isMesh && /^(Ground_MoGe|Hills_3D)/.test(o.name)) groundMeshes.push(o);
  });
  if (!groundMeshes.length) groundMeshes = [sceneRoot];
  // ακτίνα πύργου από το bbox
  const tw = sceneRoot.getObjectByName('Tower_HD');
  if (tw) { const s = new THREE.Box3().setFromObject(tw).getSize(new THREE.Vector3()); towerR = Math.max(s.x, s.z) / 2 + 0.4; }
  // έναρξη: στο μονοπάτι ~20 m από τον πύργο (Blender x=3.9, y=-19.6 → three x, z=+19.6), κοιτώντας προς αυτόν
  const sx = 3.9, sz = 19.6;
  camera.position.set(sx, groundY(sx, sz, 0) + EYE, sz);
  camera.lookAt(0, camera.position.y, 0);
  if (models.today) {
    const b = $('mode'); b.style.display = 'block'; b.textContent = 'Σήμερα'; b.onclick = toggleMode;
  }
  $('bar').style.display = 'none';
  setMsg('Κλικ για να περπατήσεις', 'WASD · Shift τρέξιμο · Esc απελευθέρωση');
  $('msg').onclick = () => controls.lock();
  renderer.setAnimationLoop(tick);
  window.__ready = true; window.__cam = camera;
  window.__place = ([x, z], [lx, ly, lz]) => { eyeY = groundY(x, z, 0) + EYE; camera.position.set(x, eyeY, z); camera.lookAt(lx, eyeY + ly, lz); };
}

async function toggleMode() {
  const b = $('mode');
  if (mode === 'historic') {
    if (!todayRoot) {
      b.textContent = 'Φόρτωση…';
      todayRoot = (await load(base + models.today)).scene;
      todayRoot.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(todayRoot);
    }
    historicNodes.forEach((n) => (n.visible = false));
    todayRoot.visible = true; mode = 'today'; b.textContent = 'Ιστορική';
  } else {
    historicNodes.forEach((n) => (n.visible = true));
    if (todayRoot) todayRoot.visible = false;
    mode = 'historic'; b.textContent = 'Σήμερα';
  }
}

// ---------- είσοδος ----------
addEventListener('keydown', (e) => (keys[e.code] = true));
addEventListener('keyup', (e) => (keys[e.code] = false));
controls.addEventListener('lock', () => { $('msg').style.display = 'none'; $('dot').style.display = 'block'; });
controls.addEventListener('unlock', () => { $('msg').style.display = 'flex'; $('dot').style.display = 'none'; setMsg('Σε παύση', 'Κλικ για συνέχεια'); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- κίνηση ----------
const clock = new THREE.Clock();
let eyeY = 0, ready = false;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (controls.isLocked) {
    const speed = (keys.ShiftLeft || keys.ShiftRight) ? RUN : WALK;
    const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    if (f || r) {
      const p = camera.position.clone();
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
      const side = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
      const step = new THREE.Vector3().addScaledVector(dir, f).addScaledVector(side, r);
      if (step.lengthSq() > 0) step.normalize().multiplyScalar(speed * dt);
      p.add(step);
      const d = Math.hypot(p.x, p.z);                       // σύγκρουση με τον πύργο (κύλινδρος στο (0,0))
      if (d < towerR) { p.x *= towerR / d; p.z *= towerR / d; }
      camera.position.x = p.x; camera.position.z = p.z;
    }
  }
  const gy = groundY(camera.position.x, camera.position.z, camera.position.y - EYE) + EYE;
  if (!ready) { eyeY = gy; ready = true; }
  eyeY += (gy - eyeY) * Math.min(1, dt * 12);
  camera.position.y = eyeY;
  sun.position.copy(camera.position).addScaledVector(sunDir, 200);   // σκιές γύρω από τον παίκτη
  sun.target.position.copy(camera.position);
  renderer.render(scene, camera);
}

init().catch((e) => { console.error(e); setMsg('Σφάλμα φόρτωσης', String(e)); });
