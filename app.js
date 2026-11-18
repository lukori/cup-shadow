import * as THREE from 'three';
import 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js';
import { drawCup, drawDog, drawRose, smooth } from './shadow.js?v=2';
import { Sound, BlowDetector } from './sound.js?v=2';

// ------------------------------------------------------------------------
// Tunable parameters. Any of them can be set in the address: ?shadowDeg=40
// With ?debug there are +/- buttons for each.
// [default, min, max, step, what it does]
const DEFAULT_PARAMS = {
  // cup + coaster (millimetres)
  cupH:       [95, 60, 160, 5, 'cup height mm'],
  cupTop:     [80, 50, 110, 2, 'cup top diameter mm'],
  cupBot:     [56, 35, 90, 2, 'cup bottom diameter mm'],
  cupX:       [0, -40, 40, 1, 'cup position: mm to the right of the coaster centre (if the cup is not exactly on the circle)'],
  cupY:       [0, -40, 40, 1, 'cup position: mm toward the red arrow'],
  // steadiness of the picture (on top of the tracker's own filter)
  poseSteady: [4, 0.5, 30, 0.5, 'how fast the shadow follows small tracking wobble (lower = calmer)'],
  poseFollow: [30, 2, 60, 2, 'how fast it follows real phone movement (higher = less lag)'],
  // shadow look
  shadowDeg:  [20, -180, 180, 10, 'direction the right shadow falls (0 = right edge of coaster, 90 = toward the red arrow / away from viewer, -90 = toward the viewer)'],
  twin:       [1, 0, 1, 1, '1 = a second, mirrored shadow on the left (two lights); 0 = one shadow'],
  shadowLen:  [0.8, 0.3, 3, 0.1, 'shadow length / cup height (1 = light at 45 deg)'],
  shadowDark: [0.5, 0.1, 0.9, 0.05, 'how dark the shadow is'],
  shadowSoft: [6, 0, 40, 1, 'edge blur (pixels of the shadow texture)'],
  life:       [1, 0, 3, 0.25, 'idle breathing / peeking of the normal shadow'],
  morph:      [3, 0.5, 10, 0.5, 'speed of changing shape (per second)'],
  dogFace:    [-1, -1, 1, 2, 'which way the dog looks: -1 = toward the viewer (red arrow points away from people), 1 = away'],
  dogSize:    [1.25, 0.6, 2.5, 0.05, 'dog height / normal shadow length'],
  roseSize:   [95, 50, 200, 5, 'rose: outer radius in mm (the cup is its centre)'],
  bloomTime:  [2.2, 0.5, 6, 0.1, 'seconds the rose takes to open'],
  // hand
  nearD:      [0.1, 0, 2, 0.05, 'hand this close (in cup sizes on screen) = fully near'],
  farD:       [1.0, 0.3, 5, 0.1, 'hand this far (in cup sizes) = not near at all'],
  handMax:    [2.4, 1, 6, 0.2, 'hand bigger than this x cup on screen = close to the phone, not the cup: ignored'],
  alertAt:    [0.35, 0.05, 0.95, 0.05, 'nearness that wakes the dog (growl)'],
  barkAt:     [0.8, 0.1, 1, 0.05, 'nearness that makes it bark'],
  calmAt:     [0.2, 0, 0.9, 0.05, 'nearness under which it calms down'],
  calmDelay:  [1.2, 0, 5, 0.1, 'seconds hand must stay away before the dog goes back to a shadow'],
  barkGap:    [0.9, 0.3, 3, 0.1, 'seconds between barks'],
  steady:     [6, 1, 20, 1, 'hand nearness smoothing (lower = steadier, slower)'],
  handEvery:  [70, 30, 300, 10, 'ms between hand detections (higher = lighter on the phone)'],
  // zone sensor: watches spots on the table around the cup; anything covering them counts as a hand
  zoneGain:   [1, 0, 2, 0.1, 'strength of the zone sensor (0 = off, hand model only)'],
  zoneDiff:   [35, 10, 120, 5, 'how much a spot must change colour to count as covered'],
  zoneFrac:   [0.12, 0.04, 0.8, 0.02, 'share of covered spots in a ring that counts as fully near'],
  zoneStill:  [0.025, 0.005, 0.3, 0.005, 'while the coaster moves on screen more than this, the zone sensor only learns (no false hands)'],
  // blow
  blowDb:     [-24, -60, 0, 2, 'mic loudness (dB) that counts as a blow'],
  blowFlat:   [0.15, 0.02, 0.9, 0.01, 'how noise-like the sound must be (speech is low)'],
  blowLow:    [0.85, 0.3, 1, 0.05, 'or: share of low rumble that counts as a blow (blowing right on the mic)'],
  blowHold:   [0.15, 0.05, 1, 0.05, 'seconds the blow must last'],
  flowerTime: [5, 1, 20, 0.5, 'seconds the flower stays'],
  // sound
  volume:     [0.8, 0, 1, 0.1, 'sound volume'],
};

const P = {};
const url = new URL(location.href);
for (const [k, d] of Object.entries(DEFAULT_PARAMS)) {
  const q = parseFloat(url.searchParams.get(k));
  P[k] = Number.isFinite(q) ? Math.min(d[2], Math.max(d[1], q)) : d[0];
}
const DEBUG = url.searchParams.has('debug');
const COASTER_MM = 150; // printed coaster width; 1 tracking unit = this many mm

// ------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const sound = new Sound();
let blow = null;
let mindar, anchor, renderer, scene, camera;
let tracked = false;
let landmarker = null, lastHandT = 0, handMs = 0, hands = [];

// shadow texture
const PLANE = 2.4;          // shadow plane side, in coaster widths (covers 36 cm of table)
const TEX = 1024;
const mask = document.createElement('canvas'); mask.width = mask.height = TEX;
const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = TEX;
const mctx = mask.getContext('2d');
const sctx = shadowCanvas.getContext('2d');
let shadowTex, occluder, guides, stage, cupG, plane;

// behaviour state
const S = {
  near: 0, nearRaw: 0, ratio: 0, handDist: 99,
  dog: false, awayFor: 0, nextBark: 0, lastBark: -9,
  flowerUntil: -1, blowFor: 0, blows: 0,
  wCup: 1, wDog: 0, wFlower: 0, state: 'cup',
  blink: 0, roseK: 0,
};

// ------------------------------------------------------------------------
$('go').addEventListener('click', start, { once: true });
if (DEBUG) { buildTune(); window.__cs = { P, S, shadowCanvas, cupOnScreen: () => cupOnScreen(), get ZONE() { return ZONE; } }; }

async function start() {
  $('go').textContent = '...';
  sound.volume = P.volume;
  sound.unlock();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('הדף צריך https ודפדפן עם מצלמה');
    mindar = new window.MINDAR.IMAGE.MindARThree({
      container: $('ar'),
      imageTargetSrc: 'assets/coaster.mind',
      uiScanning: 'no', uiLoading: 'yes', uiError: 'yes',
      filterMinCF: 0.001, filterBeta: 1, // light filter here; our own pose smoothing (poseSteady/poseFollow) does the rest
      missTolerance: 8, warmupTolerance: 3,
    });
    ({ renderer, scene, camera } = mindar);
    buildScene();
    $('start').style.display = 'none';
    await mindar.start();
  } catch (e) {
    showError('לא הצלחתי לפתוח את המצלמה.<br>' + (e?.message || '') + '<br><br>בדקו שאישרתם גישה למצלמה, ונסו לרענן.');
    return;
  }
  $('hint').style.opacity = 1;
  renderer.setAnimationLoop(frame);
  // mic and hand model after the camera is up (each asks for its own thing)
  try { blow = new BlowDetector(sound.ctx); await blow.start(); sound.resume(); }
  catch (e) { console.warn('no mic', e); blow = null; }
  loadHands();
}

function showError(html) { $('err').innerHTML = html; $('err').style.display = 'flex'; }

function buildScene() {
  anchor = mindar.addAnchor(0);
  anchor.onTargetFound = () => { tracked = true; ZONE.ref = null; ZONE.samples = 0; $('hint').style.opacity = 0; };
  anchor.onTargetLost = () => { tracked = false; POSE.lostAt = performance.now() / 1000; $('hint').style.opacity = 1; };
  // what we draw hangs on our own smoothed copy of the tracked pose (see followPose)
  stage = new THREE.Group(); stage.matrixAutoUpdate = false; stage.visible = false;
  scene.add(stage);
  cupG = new THREE.Group(); // the cup's spot on the coaster (cupX / cupY)
  stage.add(cupG);

  // invisible cup: hides the part of the shadow that is behind the real cup
  occluder = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 40),
    new THREE.MeshBasicMaterial({ colorWrite: false }),
  );
  occluder.rotation.x = Math.PI / 2;
  occluder.renderOrder = -1;
  cupG.add(occluder);

  shadowTex = new THREE.CanvasTexture(shadowCanvas);
  shadowTex.colorSpace = THREE.SRGBColorSpace;
  shadowTex.anisotropy = renderer.capabilities.getMaxAnisotropy(); // keeps it sharp when seen at an angle
  plane = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE, PLANE),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  plane.renderOrder = 1;
  cupG.add(plane);

  if (DEBUG) {
    guides = new THREE.Group();
    const sq = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0x00ff88 }),
    );
    stage.add(sq); guides.sq = sq;
    guides.cup = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 1, 16, 1)),
      new THREE.LineBasicMaterial({ color: 0xffaa00 }),
    );
    guides.cup.rotation.x = Math.PI / 2;
    guides.add(guides.cup);
    guides.visible = false;
    cupG.add(guides);
  }
  updateCupGeometry();
}

function updateCupGeometry() {
  const h = P.cupH / COASTER_MM, rt = P.cupTop / 2 / COASTER_MM, rb = P.cupBot / 2 / COASTER_MM;
  const g = new THREE.CylinderGeometry(rt, rb, h, 40);
  occluder.geometry.dispose(); occluder.geometry = g;
  occluder.scale.set(1, 1, 1);
  occluder.position.set(0, 0, h / 2);
  cupG.position.set(P.cupX / COASTER_MM, P.cupY / COASTER_MM, 0);
  if (guides) {
    guides.cup.geometry.dispose();
    guides.cup.geometry = new THREE.EdgesGeometry(new THREE.CylinderGeometry(rt, rb, h, 16, 1));
    guides.cup.position.set(0, 0, h / 2);
  }
}

// ------------------------------------------------------------------------
async function loadHands() {
  try {
    const { HandLandmarker, FilesetResolver } =
      await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.25, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3,
    });
    try { landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU')); }
  } catch (e) { console.warn('hand model failed', e); }
}

function detectHands(nowMs) {
  const video = mindar.video;
  if (!landmarker || !video || video.readyState < 2) return;
  if (nowMs - lastHandT < P.handEvery) return;
  lastHandT = nowMs;
  const t0 = performance.now();
  const res = landmarker.detectForVideo(video, nowMs);
  handMs = performance.now() - t0;
  // landmarks are 0..1 of the video; convert to screen pixels (video is "cover"-fitted)
  const left = parseFloat(video.style.left) || 0, top = parseFloat(video.style.top) || 0;
  const vw = parseFloat(video.style.width) || innerWidth, vh = parseFloat(video.style.height) || innerHeight;
  hands = (res.landmarks || []).map((lm) => lm.map((p) => [left + p.x * vw, top + p.y * vh]));
}

// cup outline on screen (pixels): box around its projected top & bottom circles
const _v = new THREE.Vector3();
function cupOnScreen() {
  const h = P.cupH / COASTER_MM, rt = P.cupTop / 2 / COASTER_MM, rb = P.cupBot / 2 / COASTER_MM;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push([Math.cos(a) * rb, Math.sin(a) * rb, 0], [Math.cos(a) * rt, Math.sin(a) * rt, h]);
  }
  let bottom = null, topP = null;
  for (const [x, y, z] of pts) {
    const [sx, sy] = toScreen(x, y, z);
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  bottom = toScreen(0, 0, 0);
  topP = toScreen(0, 0, h);
  // cup size on screen: the bigger side of its outline (works from the side and from above)
  const size = Math.max(x1 - x0, y1 - y0, Math.hypot(topP[0] - bottom[0], topP[1] - bottom[1]), 1);
  return { x0, y0, x1, y1, size };
}

// ---- zone sensor ---------------------------------------------------------
// Spots on the table in two rings around the cup (fixed to the coaster, so the
// phone may move). Each spot remembers its usual colour; a hand (or its shadow)
// over a spot changes it. Spots hidden behind the cup are skipped.
const ZONE = { cv: document.createElement('canvas'), ref: null, inner: 0, outer: 0, near: 0, last: 0, n: [0, 0] };
ZONE.ctx = ZONE.cv.getContext('2d', { willReadFrequently: true });
function zoneSpots() {
  const pts = [];
  const r1 = (P.cupBot / 2 + 20) / COASTER_MM, r2 = (P.cupBot / 2 + 44) / COASTER_MM;
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; pts.push([Math.cos(a) * r1, Math.sin(a) * r1, 0]); }
  for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2 + 0.1; pts.push([Math.cos(a) * r2, Math.sin(a) * r2, 1]); }
  return pts;
}
// coaster point (relative to the cup's spot) -> screen pixels, using the raw tracked pose
function toScreen(x, y, z) {
  _v.set(x + P.cupX / COASTER_MM, y + P.cupY / COASTER_MM, z).applyMatrix4(anchor.group.matrixWorld).project(camera);
  return [(_v.x + 1) / 2 * renderer.domElement.clientWidth, (1 - _v.y) / 2 * renderer.domElement.clientHeight];
}
function hull(p) { // convex hull (monotone chain)
  p = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function senseZone(nowMs) {
  const video = mindar.video;
  if (!tracked || !video || video.readyState < 2 || P.zoneGain <= 0) { ZONE.near = 0; ZONE.inner = ZONE.outer = 0; ZONE.prev = null; return; }
  if (nowMs - ZONE.last < 80) return;
  ZONE.last = nowMs;
  const W = 96, H = Math.round(96 * video.videoHeight / video.videoWidth);
  if (ZONE.cv.width !== W || ZONE.cv.height !== H) { ZONE.cv.width = W; ZONE.cv.height = H; ZONE.ref = null; }
  ZONE.ctx.drawImage(video, 0, 0, W, H); // small = blurred, so tracking jitter matters less
  const img = ZONE.ctx.getImageData(0, 0, W, H).data;
  const left = parseFloat(video.style.left) || 0, top = parseFloat(video.style.top) || 0;
  const vw = parseFloat(video.style.width) || innerWidth, vh = parseFloat(video.style.height) || innerHeight;
  // How much did the coaster move on screen since the last look (in half coaster widths)?
  // While it moves (phone moving, or the tracker still settling after it locks on) the spots
  // slide over the busy print and everything looks "covered". Then we only learn, never count.
  // (centre and two edges, so turning around the cup counts as moving too)
  const cs = [toScreen(0, 0, 0), toScreen(0.5, 0, 0), toScreen(0, 0.5, 0)];
  const scale = Math.max(1, Math.hypot(cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]));
  ZONE.moved = ZONE.prev ? Math.max(...cs.map((c, i) => Math.hypot(c[0] - ZONE.prev[i][0], c[1] - ZONE.prev[i][1]))) / scale : 1;
  ZONE.prev = cs;
  ZONE.still = ZONE.moved < P.zoneStill ? (ZONE.still || 0) + 1 : 0;
  ZONE.samples = (ZONE.samples || 0) + 1;
  // counting starts 1.2 s after locking on, and only once the picture has been still for 0.4 s
  const counting = ZONE.samples > 15 && ZONE.still >= 5;
  // the cup's outline on screen: spots inside it are hidden by the cup
  const h = P.cupH / COASTER_MM, rt = P.cupTop / 2 / COASTER_MM, rb = P.cupBot / 2 / COASTER_MM;
  const cupPts = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; cupPts.push(toScreen(Math.cos(a) * rb * 1.1, Math.sin(a) * rb * 1.1, 0), toScreen(Math.cos(a) * rt * 1.1, Math.sin(a) * rt * 1.1, h)); }
  const cupPoly = hull(cupPts);
  const spots = zoneSpots();
  if (!ZONE.ref || ZONE.ref.length !== spots.length) ZONE.ref = spots.map(() => null);
  const cov = spots.map(() => null); // null = not seen, false = clear, true = covered
  spots.forEach(([x, y], i) => {
    const [sx, sy] = toScreen(x, y, 0);
    if (inside(cupPoly, sx, sy)) { ZONE.ref[i] = null; return; }
    const px = Math.round((sx - left) / vw * W), py = Math.round((sy - top) / vh * H);
    if (px < 2 || py < 2 || px >= W - 2 || py >= H - 2) return;
    // average of a 3x3 patch: a pixel of tracking wobble barely changes it
    const c = [0, 0, 0];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const o = ((py + dy) * W + px + dx) * 4;
      c[0] += img[o] / 9; c[1] += img[o + 1] / 9; c[2] += img[o + 2] / 9;
    }
    const r = ZONE.ref[i];
    if (!r) { ZONE.ref[i] = c; return; }
    // biggest change in any colour channel: skin over the print is mostly a change of hue
    const diff = Math.max(Math.abs(c[0] - r[0]), Math.abs(c[1] - r[1]), Math.abs(c[2] - r[2]));
    const covered = counting && diff > P.zoneDiff;
    cov[i] = covered; (ZONE.diffs ||= [])[i] = Math.round(diff);
    // learn the usual colour: fast while not counting (moving / just locked on); very slowly
    // for a spot that changed even half-way (a hand held still stays a hand for ~30 s)
    const k = !counting ? 0.3 : diff > P.zoneDiff * 0.5 ? 0.002 : 0.12;
    for (let j = 0; j < 3; j++) r[j] += (c[j] - r[j]) * k;
  });
  // A real hand covers spots next to each other; wobble flips scattered single spots.
  // So a covered spot only counts if a neighbour in its ring is covered too.
  const rings = [[0, 18], [18, 44]];
  const share = rings.map(([a, b]) => {
    const n = b - a;
    let tot = 0, hit = 0;
    for (let i = a; i < b; i++) {
      if (cov[i] === null) continue;
      tot++;
      const prv = cov[a + (i - a + n - 1) % n], nxt = cov[a + (i - a + 1) % n];
      if (cov[i] && (prv || nxt)) hit++;
    }
    return { tot, f: tot >= 4 ? hit / tot : 0 };
  });
  ZONE.n = share.map((q) => q.tot);
  if (counting) { ZONE.inner = share[0].f; ZONE.outer = share[1].f; }
  else { ZONE.inner *= 0.8; ZONE.outer *= 0.8; } // moving: let the last reading fade, don't invent one
  // outer ring covered = coming near (growl); inner ring = right at the cup (bark)
  ZONE.near = Math.max(0.6 * smooth(ZONE.outer / P.zoneFrac), smooth(ZONE.inner / P.zoneFrac)) * P.zoneGain;
}

function measureNear() {
  if (!tracked || (!hands.length && !fakeHand)) { S.nearRaw = 0; S.handDist = 99; S.ratio = 0; return; }
  const cup = cupOnScreen();
  let best = 0, bestD = 99, bestR = 0;
  const all = fakeHand ? [...hands, fakeHandPoints(cup)] : hands;
  for (const lm of all) {
    let d = Infinity;
    for (const [x, y] of lm) {
      const dx = Math.max(cup.x0 - x, 0, x - cup.x1), dy = Math.max(cup.y0 - y, 0, y - cup.y1);
      d = Math.min(d, Math.hypot(dx, dy));
    }
    d /= cup.size;
    // palm length (wrist -> middle knuckle) compared to cup height on screen.
    // Same depth as the cup: about 1. Much bigger: the hand is near the phone.
    const palm = Math.hypot(lm[9][0] - lm[0][0], lm[9][1] - lm[0][1]);
    const ratio = palm / cup.size;
    const depthOK = 1 - smooth((ratio - P.handMax) / (P.handMax * 0.5));
    const n = (1 - smooth((d - P.nearD) / Math.max(0.05, P.farD - P.nearD))) * depthOK;
    if (n >= best) { best = n; bestD = d; bestR = ratio; }
  }
  S.nearRaw = best; S.handDist = bestD; S.ratio = bestR;
}
function nearNow() { return Math.min(1, Math.max(S.nearRaw, ZONE.near)); }

// debug: hold a finger / the mouse on the screen = a pretend hand at that spot
let fakeHand = null;
function fakeHandPoints(cup) {
  const [x, y] = fakeHand, r = cup.size * 0.45;
  const pts = Array.from({ length: 21 }, (_, i) => [x + Math.cos(i) * r * 0.5, y + Math.sin(i) * r * 0.5]);
  pts[0] = [x, y + r]; pts[9] = [x, y - r * 0.8]; // palm about cup-sized, like a real hand next to the cup
  return pts;
}
if (DEBUG) {
  const ar = $('ar');
  const at = (e) => { fakeHand = [e.clientX, e.clientY]; };
  ar.addEventListener("pointerdown", (e) => { at(e); try { ar.setPointerCapture(e.pointerId); } catch {} });
  ar.addEventListener('pointermove', (e) => { if (fakeHand) at(e); });
  ar.addEventListener('pointerup', () => { fakeHand = null; });
  ar.addEventListener('pointercancel', () => { fakeHand = null; });
}


// ---- steady picture ---------------------------------------------------------
// The tracker's pose wobbles a little even when nothing moves. We keep our own copy:
// it creeps toward the tracked pose slowly when the difference is tiny (wobble) and
// catches up fast when it is big (the phone really moved).
const POSE = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), has: false, vis: 0, lostAt: -9 };
const _tp = new THREE.Vector3(), _tq = new THREE.Quaternion(), _ts = new THREE.Vector3();
function followPose(dt, t) {
  if (tracked) {
    anchor.group.updateMatrixWorld();
    anchor.group.matrixWorld.decompose(_tp, _tq, _ts);
    if (!POSE.has) { POSE.p.copy(_tp); POSE.q.copy(_tq); POSE.s.copy(_ts); POSE.has = true; }
    // difference in coaster widths (+ angle in radians)
    const d = _tp.distanceTo(POSE.p) / Math.max(1e-6, _ts.x) + POSE.q.angleTo(_tq) * 0.5;
    const rate = P.poseSteady + (P.poseFollow - P.poseSteady) * smooth(d / 0.04);
    const a = 1 - Math.exp(-dt * rate);
    POSE.p.lerp(_tp, a); POSE.q.slerp(_tq, a); POSE.s.lerp(_ts, a);
    POSE.vis = Math.min(1, POSE.vis + dt * 4);
  } else {
    // lost: hold still for a moment (a hand passing in front), then fade out
    if (t - POSE.lostAt > 0.35) POSE.vis = Math.max(0, POSE.vis - dt * 3);
    if (POSE.vis === 0) POSE.has = false;
  }
  stage.matrix.compose(POSE.p, POSE.q, POSE.s);
  stage.matrixWorldNeedsUpdate = true;
  stage.visible = POSE.has && POSE.vis > 0;
  plane.material.opacity = smooth(POSE.vis);
}

// ------------------------------------------------------------------------
let lastT = performance.now(), fps = 0, lastDraw = 0;

function frame() {
  const nowMs = performance.now();
  const dt = Math.min(0.1, (nowMs - lastT) / 1000);
  lastT = nowMs;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  const t = nowMs / 1000;

  followPose(dt, t);
  if (tracked) detectHands(nowMs);
  else hands = [];
  measureNear();
  senseZone(nowMs);
  S.near += (nearNow() - S.near) * (1 - Math.exp(-dt * P.steady));

  // ---- blow
  if (blow) {
    blow.update();
    const mine = t < sound.busyUntil;
    const isBlow = !mine && blow.db > P.blowDb && (blow.flat > P.blowFlat || blow.low > P.blowLow);
    S.blowFor = isBlow ? S.blowFor + dt : 0;
    if (S.blowFor > P.blowHold) {
      if (t > S.flowerUntil) { sound.bloom(); S.blows++; }
      S.flowerUntil = t + P.flowerTime;
      S.blowFor = -0.6; // short pause before the next blow counts
    }
  }

  // ---- dog wakes / calms
  if (S.near > P.alertAt) { S.dog = true; S.awayFor = 0; }
  else if (S.near < P.calmAt) { S.awayFor += dt; if (S.awayFor > P.calmDelay) S.dog = false; }
  else S.awayFor = 0;

  const flowering = t < S.flowerUntil;
  S.state = flowering ? 'flower' : S.dog ? 'dog' : 'cup';

  if (S.state === 'dog' && S.near > P.barkAt && t > S.nextBark && S.wDog > 0.7) {
    sound.bark();
    if (P.twin >= 0.5) sound.bark({ delay: 0.13, rate: 0.86, gain: 0.7 }); // the second dog answers
    S.lastBark = t;
    S.nextBark = t + P.barkGap * (0.75 + Math.random() * 0.5);
  }
  const growl = S.state === 'dog' ? 0.25 + 0.75 * smooth((S.near - P.calmAt) / Math.max(0.05, P.barkAt - P.calmAt)) : 0;
  sound.volume = P.volume;
  sound.setGrowl(growl * S.wDog);

  // ---- shape weights
  const step = dt * P.morph;
  const go = (w, on) => on ? Math.min(1, w + step) : Math.max(0, w - step);
  // the old shape shrinks first, then the new one grows (no muddy overlap)
  const others = { cup: S.wDog + Math.max(S.wFlower, S.roseK), dog: S.wCup + Math.max(S.wFlower, S.roseK), flower: S.wCup + S.wDog };
  S.wCup = go(S.wCup, S.state === 'cup' && others.cup < 0.35);
  S.wDog = go(S.wDog, S.state === 'dog' && others.dog < 0.35);
  S.wFlower = go(S.wFlower, S.state === 'flower' && others.flower < 0.35);
  // the rose opens slowly and closes a little faster
  S.roseK = S.wFlower > 0.5 && S.state === 'flower' ? Math.min(1, S.roseK + dt / P.bloomTime) : Math.max(0, S.roseK - dt / 1.1);

  if (Math.random() < dt * 0.3) S.blink = t + 0.12;

  // redraw the shadow at most ~40 fps
  if (nowMs - lastDraw > 24) { lastDraw = nowMs; drawShadow(t); }
  if (guides) { guides.visible = tuneGuides; guides.sq.visible = tuneGuides; }
  renderer.render(scene, camera);
  if (DEBUG) updateTune(t);
}

function drawShadow(t) {
  const len = P.cupH * P.shadowLen;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, TEX, TEX);
  // mm -> texture pixels, y flipped so the texture matches the table (y = toward the red arrow)
  const k = TEX / (PLANE * COASTER_MM);
  // right shadow, plus (twin) its mirror image on the left, as if lit by two lamps.
  // The twin barks a moment later and breathes out of step, so they feel like two dogs.
  const shadows = [{ deg: P.shadowDeg, face: P.dogFace, lag: 0, phase: 0 }];
  if (P.twin >= 0.5) shadows.push({ deg: 180 - P.shadowDeg, face: -P.dogFace, lag: 0.13, phase: 5.3 });
  const growlAmt = S.state === 'dog' ? smooth((S.near - P.calmAt) / Math.max(0.05, P.barkAt - P.calmAt)) : 0;
  for (const sh of shadows) {
    mctx.setTransform(k, 0, 0, -k, TEX / 2, TEX / 2);
    mctx.rotate(sh.deg * Math.PI / 180);
    mctx.fillStyle = '#000'; mctx.strokeStyle = '#000';
    const tt = t + sh.phase;
    const sinceBark = t - S.lastBark - sh.lag;
    const barkEnv = sinceBark < 0 ? 0 : sinceBark < 0.06 ? sinceBark / 0.06 : Math.max(0, 1 - (sinceBark - 0.06) / 0.22);
    drawCup(mctx, { rBot: P.cupBot / 2, rTop: P.cupTop / 2, len, k: smooth(S.wCup), t: tt, life: P.life });
    drawDog(mctx, {
      H: len * P.dogSize, k: S.wDog, face: sh.face,
      jaw: Math.max(barkEnv, 0.12 * growlAmt), ear: 0.3 + 0.7 * Math.max(growlAmt, barkEnv),
      shake: growlAmt * (1 - barkEnv), lunge: barkEnv, t: tt, blink: t < S.blink,
    });
  }
  // the rose: one flower with the cup as its middle
  mctx.setTransform(k, 0, 0, -k, TEX / 2, TEX / 2);
  drawRose(mctx, { R: P.roseSize, r0: P.cupBot / 2, k: S.roseK, t });

  // soft edges: draw the mask's own blurred shadow, offset so only the shadow lands
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, TEX, TEX);
  sctx.shadowColor = `rgba(0,0,0,${P.shadowDark})`;
  sctx.shadowBlur = P.shadowSoft;
  sctx.shadowOffsetX = TEX;
  sctx.drawImage(mask, -TEX, 0);
  shadowTex.needsUpdate = true;
}

// ------------------------------------------------------------------------
// debug panel (?debug)
let tuneGuides = false, tuneMin = true; // panel starts folded: live numbers + test buttons only
const log = [];
let lastLog = 0;

function buildTune() {
  const el = $('tune');
  el.style.display = 'block';
  el.classList.add('min');
  let rows = '';
  for (const [k, d] of Object.entries(DEFAULT_PARAMS)) {
    rows += `<div class="row" title="${d[4]}"><b>${k}</b><button data-k="${k}" data-s="-1">-</button><i id="pv-${k}"></i><button data-k="${k}" data-s="1">+</button></div>`;
  }
  el.innerHTML = `
    <div class="btns">
      <button id="t-min">values</button><button id="t-guides">guides</button>
      <button id="t-dog">dog</button><button id="t-bark">bark</button><button id="t-flower">flower</button><button id="t-calm">calm</button>
    </div>
    <div class="live" id="t-live"></div>
    <div class="btns2"><button id="t-copy">Copy log</button><button id="t-save">Save log</button><button id="t-reset">defaults</button></div>
    <div class="rows">${rows}</div>`;
  el.querySelectorAll('.row button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k, d = DEFAULT_PARAMS[k];
    const v = Math.round((P[k] + d[3] * +b.dataset.s) / d[3]) * d[3];
    P[k] = +Math.min(d[2], Math.max(d[1], v)).toFixed(4);
    if (k.startsWith('cup') && occluder) updateCupGeometry();
    writeUrl();
  }));
  $('t-min').onclick = () => { tuneMin = !tuneMin; el.classList.toggle('min', tuneMin); $('t-min').textContent = tuneMin ? 'values' : 'fold'; };
  $('t-guides').onclick = () => { tuneGuides = !tuneGuides; };
  $('t-dog').onclick = () => { S.dog = true; S.awayFor = -3; };
  $('t-bark').onclick = () => { S.dog = true; S.awayFor = -3; sound.bark(); if (P.twin >= 0.5) sound.bark({ delay: 0.13, rate: 0.86, gain: 0.7 }); S.lastBark = performance.now() / 1000; };
  $('t-flower').onclick = () => { sound.bloom(); S.flowerUntil = performance.now() / 1000 + P.flowerTime; };
  $('t-calm').onclick = () => { S.dog = false; S.flowerUntil = -1; };
  $('t-copy').onclick = async () => { try { await navigator.clipboard.writeText(logText()); $('t-copy').textContent = 'copied'; } catch { $('t-copy').textContent = 'failed'; } };
  $('t-save').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([logText()], { type: 'text/plain' }));
    a.download = `cup-shadow-log-${Date.now()}.txt`; a.click();
  };
  $('t-reset').onclick = () => { for (const [k, d] of Object.entries(DEFAULT_PARAMS)) P[k] = d[0]; if (occluder) updateCupGeometry(); writeUrl(); };
  writeUrl();
}

function writeUrl() {
  const u = new URL(location.href);
  for (const [k, d] of Object.entries(DEFAULT_PARAMS)) {
    if (P[k] !== d[0]) u.searchParams.set(k, P[k]); else u.searchParams.delete(k);
    const pv = $('pv-' + k); if (pv) pv.textContent = P[k];
  }
  history.replaceState(null, '', u);
}

function liveNumbers() {
  return {
    fps: fps.toFixed(0), tracked, state: S.state,
    near: S.near.toFixed(2), nearRaw: S.nearRaw.toFixed(2), handDist: S.handDist.toFixed(2), handRatio: S.ratio.toFixed(2),
    hands: hands.length, handMs: handMs.toFixed(0), handModel: landmarker ? 'ok' : 'loading',
    zoneIn: ZONE.inner.toFixed(2), zoneOut: ZONE.outer.toFixed(2), zoneNear: ZONE.near.toFixed(2), zoneSpots: ZONE.n.join('+'), zoneMoved: (ZONE.moved ?? 0).toFixed(3), zoneStill: ZONE.still || 0,
    micDb: blow ? blow.db.toFixed(1) : 'off', micFlat: blow ? blow.flat.toFixed(2) : '-', micLow: blow ? blow.low.toFixed(2) : '-',
    blows: S.blows, audio: sound.ctx ? sound.ctx.state : '-',
  };
}

function updateTune(t) {
  const L = liveNumbers();
  $('t-live').textContent =
    `fps ${L.fps}  tracked ${L.tracked}  state ${L.state}\n` +
    `near ${L.near} (raw ${L.nearRaw})  dist ${L.handDist}  hand/cup ${L.handRatio}\n` +
    `hands ${L.hands}  ${L.handMs}ms  model ${L.handModel}\n` +
    `zone in ${L.zoneIn} out ${L.zoneOut} -> ${L.zoneNear}  spots ${L.zoneSpots}  moved ${L.zoneMoved}\n` +
    `mic ${L.micDb} dB  flat ${L.micFlat}  low ${L.micLow}  blows ${L.blows}  audio ${L.audio}`;
  if (t - lastLog > 0.25) {
    lastLog = t;
    log.push({ t: +t.toFixed(2), ...L });
    if (log.length > 2400) log.shift();
  }
}

function logText() {
  const head = `cup-shadow log ${new Date().toISOString()}\n${navigator.userAgent}\nparams ${JSON.stringify(P)}\n`;
  return head + log.map((r) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' ')).join('\n');
}
