import * as THREE from 'three';
import 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js';
import { drawCup, drawDog, drawFlower, smooth } from './shadow.js?v=1';
import { Sound, BlowDetector } from './sound.js?v=1';

// ------------------------------------------------------------------------
// Tunable parameters. Any of them can be set in the address: ?shadowDeg=40
// With ?debug there are +/- buttons for each.
// [default, min, max, step, what it does]
const DEFAULT_PARAMS = {
  // cup + coaster (millimetres)
  cupH:       [95, 60, 160, 5, 'cup height mm'],
  cupTop:     [80, 50, 110, 2, 'cup top diameter mm'],
  cupBot:     [56, 35, 90, 2, 'cup bottom diameter mm'],
  // shadow look
  shadowDeg:  [-50, -180, 180, 10, 'direction the shadow falls (0 = right edge of coaster, 90 = toward the red arrow, -90 = toward the viewer)'],
  shadowLen:  [0.8, 0.3, 3, 0.1, 'shadow length / cup height (1 = light at 45 deg)'],
  shadowDark: [0.5, 0.1, 0.9, 0.05, 'how dark the shadow is'],
  shadowSoft: [4, 0, 40, 1, 'edge blur (pixels of the shadow texture)'],
  life:       [1, 0, 3, 0.25, 'idle breathing / peeking of the normal shadow'],
  morph:      [3, 0.5, 10, 0.5, 'speed of changing shape (per second)'],
  dogFace:    [-1, -1, 1, 2, 'which way the dog looks: -1 = toward the viewer (red arrow points away from people), 1 = away'],
  dogSize:    [1.25, 0.6, 2.5, 0.05, 'dog height / normal shadow length'],
  flowerSize: [1.4, 0.6, 3, 0.05, 'flower height / normal shadow length'],
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
  // blow
  blowDb:     [-24, -60, 0, 2, 'mic loudness (dB) that counts as a blow'],
  blowFlat:   [0.15, 0.02, 0.9, 0.01, 'how noise-like the sound must be (speech is low)'],
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
let shadowTex, occluder, guides;

// behaviour state
const S = {
  near: 0, nearRaw: 0, ratio: 0, handDist: 99,
  dog: false, awayFor: 0, nextBark: 0, lastBark: -9,
  flowerUntil: -1, blowFor: 0, blows: 0,
  wCup: 1, wDog: 0, wFlower: 0, state: 'cup',
  blink: 0,
};

// ------------------------------------------------------------------------
$('go').addEventListener('click', start, { once: true });
if (DEBUG) { buildTune(); window.__cs = { P, S, shadowCanvas, cupOnScreen: () => cupOnScreen() }; }

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
      filterMinCF: 0.0005, filterBeta: 0.01, // steadier than the default, a little more lag
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
  anchor.onTargetFound = () => { tracked = true; $('hint').style.opacity = 0; };
  anchor.onTargetLost = () => { tracked = false; $('hint').style.opacity = 1; };

  // invisible cup: hides the part of the shadow that is behind the real cup
  occluder = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 40),
    new THREE.MeshBasicMaterial({ colorWrite: false }),
  );
  occluder.rotation.x = Math.PI / 2;
  occluder.renderOrder = -1;
  anchor.group.add(occluder);

  shadowTex = new THREE.CanvasTexture(shadowCanvas);
  shadowTex.colorSpace = THREE.SRGBColorSpace;
  shadowTex.anisotropy = renderer.capabilities.getMaxAnisotropy(); // keeps it sharp when seen at an angle
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE, PLANE),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
  );
  plane.renderOrder = 1;
  anchor.group.add(plane);

  if (DEBUG) {
    guides = new THREE.Group();
    const sq = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
      new THREE.LineBasicMaterial({ color: 0x00ff88 }),
    );
    guides.add(sq);
    guides.cup = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 1, 16, 1)),
      new THREE.LineBasicMaterial({ color: 0xffaa00 }),
    );
    guides.cup.rotation.x = Math.PI / 2;
    guides.add(guides.cup);
    guides.visible = false;
    anchor.group.add(guides);
  }
  updateCupGeometry();
}

function updateCupGeometry() {
  const h = P.cupH / COASTER_MM, rt = P.cupTop / 2 / COASTER_MM, rb = P.cupBot / 2 / COASTER_MM;
  const g = new THREE.CylinderGeometry(rt, rb, h, 40);
  occluder.geometry.dispose(); occluder.geometry = g;
  occluder.scale.set(1, 1, 1);
  occluder.position.set(0, 0, h / 2);
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
      minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
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
    _v.set(x, y, z).applyMatrix4(anchor.group.matrixWorld).project(camera);
    const sx = (_v.x + 1) / 2 * W, sy = (1 - _v.y) / 2 * H;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  _v.set(0, 0, 0).applyMatrix4(anchor.group.matrixWorld).project(camera);
  bottom = [(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H];
  _v.set(0, 0, h).applyMatrix4(anchor.group.matrixWorld).project(camera);
  topP = [(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H];
  // cup size on screen: the bigger side of its outline (works from the side and from above)
  const size = Math.max(x1 - x0, y1 - y0, Math.hypot(topP[0] - bottom[0], topP[1] - bottom[1]), 1);
  return { x0, y0, x1, y1, size };
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

// ------------------------------------------------------------------------
let lastT = performance.now(), fps = 0, lastDraw = 0;

function frame() {
  const nowMs = performance.now();
  const dt = Math.min(0.1, (nowMs - lastT) / 1000);
  lastT = nowMs;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  const t = nowMs / 1000;

  if (tracked) detectHands(nowMs);
  else hands = [];
  measureNear();
  S.near += (S.nearRaw - S.near) * (1 - Math.exp(-dt * P.steady));

  // ---- blow
  if (blow) {
    blow.update();
    const mine = t < sound.busyUntil;
    const isBlow = !mine && blow.db > P.blowDb && blow.flat > P.blowFlat;
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
  const others = { cup: S.wDog + S.wFlower, dog: S.wCup + S.wFlower, flower: S.wCup + S.wDog };
  S.wCup = go(S.wCup, S.state === 'cup' && others.cup < 0.35);
  S.wDog = go(S.wDog, S.state === 'dog' && others.dog < 0.35);
  S.wFlower = go(S.wFlower, S.state === 'flower' && others.flower < 0.35);

  if (Math.random() < dt * 0.3) S.blink = t + 0.12;

  // redraw the shadow at most ~40 fps
  if (nowMs - lastDraw > 24) { lastDraw = nowMs; drawShadow(t); }
  if (guides) guides.visible = tuneGuides;
  renderer.render(scene, camera);
  if (DEBUG) updateTune(t);
}

function drawShadow(t) {
  const len = P.cupH * P.shadowLen;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, TEX, TEX);
  // mm -> texture pixels, y flipped so the texture matches the table (y = toward the red arrow)
  const k = TEX / (PLANE * COASTER_MM);
  const a = P.shadowDeg * Math.PI / 180;
  mctx.setTransform(k, 0, 0, -k, TEX / 2, TEX / 2);
  mctx.rotate(a);
  mctx.fillStyle = '#000'; mctx.strokeStyle = '#000';

  const sinceBark = t - S.lastBark;
  const barkEnv = sinceBark < 0.06 ? sinceBark / 0.06 : Math.max(0, 1 - (sinceBark - 0.06) / 0.22);
  const growlAmt = S.state === 'dog' ? smooth((S.near - P.calmAt) / Math.max(0.05, P.barkAt - P.calmAt)) : 0;

  drawCup(mctx, { rBot: P.cupBot / 2, rTop: P.cupTop / 2, len, k: smooth(S.wCup), t, life: P.life });
  drawDog(mctx, {
    H: len * P.dogSize, k: S.wDog, face: P.dogFace,
    jaw: Math.max(barkEnv, 0.12 * growlAmt), ear: 0.3 + 0.7 * Math.max(growlAmt, barkEnv),
    shake: growlAmt * (1 - barkEnv), lunge: barkEnv, t, blink: t < S.blink,
  });
  drawFlower(mctx, { H: len * P.flowerSize, k: S.wFlower, t, sway: 1 });

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
  $('t-bark').onclick = () => { S.dog = true; S.awayFor = -3; sound.bark(); S.lastBark = performance.now() / 1000; };
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
