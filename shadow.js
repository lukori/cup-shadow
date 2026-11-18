// Draws the fake shadow (cup / dog / flower) into a canvas that lies flat on the table.
//
// Drawing frame (millimetres, on the table):
//   origin = middle of the cup's base
//   +u     = the direction the shadow falls (away from the light)
//   +v     = sideways (the dog's snout points this way)
// All three shapes grow out of the cup's base, so a morph looks like the
// cup's own shadow turning into something else.

const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// Smooth closed shape through points (midpoint quadratic curves).
function blob(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], q[0], q[1]);
  }
  ctx.closePath();
}

// points are given as [v, u]; canvas x = u, canvas y = v (the canvas transform does the rest)
const toXY = (pts) => pts.map(([v, u]) => [u, v]);

function rotAround(pts, cv, cu, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([v, u]) => {
    const dv = v - cv, du = u - cu;
    return [cv + dv * c - du * s, cu + dv * s + du * c];
  });
}

// ---- cup ---------------------------------------------------------------
export function drawCup(ctx, g) {
  // g: { rBot, rTop, len, k (0..1 grow), t, life }
  if (g.k <= 0.001) return;
  const breathe = 1 + 0.012 * g.life * Math.sin(g.t * 1.3);
  // once in a while the shadow "peeks": a short wobble of its far end
  const peekPhase = (g.t % 11) / 11;
  const peek = g.life * (peekPhase > 0.9 ? Math.sin((peekPhase - 0.9) / 0.1 * Math.PI) : 0);
  const L = g.len * g.k * breathe;
  const tipV = 6 * peek;
  const r0 = g.rBot, r1 = g.rBot + (g.rTop - g.rBot) * g.k;
  ctx.beginPath();
  ctx.arc(0, 0, r0, 0, Math.PI * 2);
  ctx.moveTo(L + r1, tipV);
  ctx.arc(L, tipV, r1, 0, Math.PI * 2);
  ctx.moveTo(0, -r0);
  ctx.lineTo(L, tipV - r1);
  ctx.lineTo(L, tipV + r1);
  ctx.lineTo(0, r0);
  ctx.closePath();
  ctx.fill();
}

// ---- dog head (shadow-puppet profile) -----------------------------------
// [v, u] with u = 0 at the base and u = 1 at the top of the head
const DOG_HEAD = [
  [-0.26, 0.00], [-0.27, 0.35], [-0.29, 0.58], [-0.26, 0.76],     // back of neck / head
  /* ear goes here */
  [0.04, 0.92], [0.14, 0.89], [0.21, 0.83],                       // forehead, stop
  [0.30, 0.805], [0.40, 0.79], [0.45, 0.785], [0.475, 0.76], [0.47, 0.725], // muzzle to nose
  [0.42, 0.705], [0.34, 0.695], [0.27, 0.685],                    // upper lip back to mouth corner
];
const DOG_JAW = [ // lower jaw, from mouth corner forward and back under the chin
  [0.27, 0.685], [0.36, 0.68], [0.42, 0.672], [0.41, 0.64], [0.30, 0.60], [0.16, 0.57],
];
const JAW_PIVOT = [0.27, 0.685];
const DOG_NECK_FRONT = [[0.13, 0.48], [0.17, 0.25], [0.23, 0.00]];
const DOG_EYE = [0.12, 0.83];

export function drawDog(ctx, g) {
  // g: { H (height mm), k, face (+1/-1), jaw 0..1, ear 0..1 (1 = pricked), shake, lunge, t }
  if (g.k <= 0.001) return;
  const s = g.H * (0.35 + 0.65 * smooth(g.k));
  const ear = g.ear;
  // ear: pricked up when alert, folded back when calm (tip point doubled = sharper tip)
  const tip = [-0.18 - 0.16 * (1 - ear), 1.08 * ear + 0.93 * (1 - ear)];
  const earPts = [[-0.22, 0.82], tip, tip, [-0.06, 0.90]];
  // lower jaw rotates down around the mouth corner
  const jawA = -g.jaw * 0.55;
  const jaw = rotAround(DOG_JAW, JAW_PIVOT[0], JAW_PIVOT[1], jawA);
  let pts = [...DOG_HEAD.slice(0, 4), ...earPts, ...DOG_HEAD.slice(4), ...jaw, ...DOG_NECK_FRONT];
  // the whole head leans forward on a bark, trembles on a growl
  const lean = 0.10 * g.lunge + g.shake * 0.02 * Math.sin(g.t * 47) ;
  pts = rotAround(pts, 0, 0, -lean);
  pts = pts.map(([v, u]) => [v * s * g.face, u * s * (1 + 0.06 * g.lunge)]);
  ctx.beginPath();
  blob(ctx, toXY(pts));
  ctx.fill();
  // eye hole, like a real hand-shadow puppet
  if (g.k > 0.6) {
    let [ev, eu] = rotAround([DOG_EYE], 0, 0, -lean)[0];
    ev *= s * g.face; eu *= s * (1 + 0.06 * g.lunge);
    const r = s * 0.03 * smooth((g.k - 0.6) / 0.4) * (g.blink ? 0.25 : 1);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.ellipse(eu, ev, r, r * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ---- flower --------------------------------------------------------------
export function drawFlower(ctx, g) {
  // g: { H (height mm), k, t, sway }
  if (g.k <= 0.001) return;
  const stemK = smooth(g.k / 0.6);
  const bloom = smooth((g.k - 0.45) / 0.55);
  const H = g.H * stemK;
  const sw = g.sway * Math.sin(g.t * 1.7) * 0.08;
  const stemAt = (f) => [Math.sin(f * 2.2) * 0.05 * g.H + sw * g.H * f * f, H * f];
  // stem
  ctx.lineCap = 'round';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const [v, u] = stemAt(i / 16);
    if (i === 0) ctx.moveTo(u, v); else ctx.lineTo(u, v);
  }
  ctx.stroke();
  // leaves
  const leaf = (f, side, size) => {
    const [v, u] = stemAt(f);
    const L = g.H * size * stemK;
    ctx.save();
    ctx.translate(u, v);
    ctx.rotate(side * (0.9 + 0.08 * Math.sin(g.t * 1.3 + f * 5)));
    ctx.beginPath();
    ctx.ellipse(L / 2, 0, L / 2, L * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  leaf(0.32, 1, 0.22);
  leaf(0.52, -1, 0.18);
  // head
  if (bloom > 0) {
    const [v, u] = stemAt(1);
    const n = 7;
    const pl = g.H * 0.19 * bloom;
    const spin = g.t * 0.25;
    ctx.save();
    ctx.translate(u, v);
    for (let i = 0; i < n; i++) {
      const a = spin + (i / n) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(pl * 0.62, 0, pl * 0.55, pl * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, pl * 0.32, 0, Math.PI * 2);
    ctx.fill();
    // light ring between centre and petals keeps it readable as a flower
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = pl * 0.07;
    ctx.beginPath();
    ctx.arc(0, 0, pl * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
}

// ---- rose -------------------------------------------------------------------
// One rose lying on the table with the cup standing in its middle, seen from above.
// Like a real rose: a few broad petals per ring, each ring turned against the last,
// inner petals lying on top of the outer ones. A thin light seam along each petal's
// edge shows the layers. Rings open from the middle outward; each petal unfurls
// (grows outward, widens, untwists).
const ROSE_RINGS = [ // count, base (0 = cup edge, 1 = rose edge), tip, twist when closed
  [5, 0.30, 1.00, 0.35],
  [5, 0.18, 0.80, 0.45],
  [5, 0.08, 0.60, 0.55],
  [4, 0.00, 0.42, 0.7],
  [3, 0.00, 0.26, 0.9],
];
const ROSE_PETALS = (() => {
  // fixed pseudo-random numbers, so the rose looks the same every time
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const out = [];
  ROSE_RINGS.forEach(([n, b, tip, twist], j) => {
    const turn = j * 0.63 + rnd() * 0.2; // each ring sits between the petals of the next
    for (let i = 0; i < n; i++) {
      out.push({
        ring: ROSE_RINGS.length - 1 - j, // 0 = innermost (opens first)
        b, tip: tip * (0.94 + rnd() * 0.08), twist,
        a: turn + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.12,
        w: (Math.PI / n) * (1.12 + rnd() * 0.12), // half-width: overlaps the neighbours
        seed: rnd() * 100,
      });
    }
  });
  return out; // outer ring first: inner petals are drawn on top
})();

function petalPath(g, p, o) {
  const span = g.R - g.r0;
  const breathe = 1 + 0.012 * Math.sin(g.t * 0.9 + p.seed);
  const rb = g.r0 * 0.75 + span * p.b;
  const rt = (rb + (g.r0 + span * p.tip - rb) * (0.15 + 0.85 * o)) * breathe;
  const th = p.w * (0.4 + 0.6 * o);
  const a0 = p.a + p.twist * (1 - o) + 0.01 * Math.sin(g.t * 0.6 + p.seed);
  const L = rt - rb;
  const side = [];
  for (let s = 0; s <= 0.75; s += 0.15) {
    // narrow at the base, full width from about the middle
    const hw = th * (0.3 + 0.7 * Math.pow(Math.sin(Math.min(1, s / 0.6) * Math.PI / 2), 0.9));
    side.push([rb + L * s, hw]);
  }
  // broad, rounded top edge with a soft dip in the middle (heart-like rose petal)
  const top = [];
  for (let i = 0; i <= 10; i++) {
    const f = -1 + i / 5; // -1 .. 1
    const r = rt * (1 - 0.13 * Math.pow(Math.abs(f), 2.2))
      + 0.015 * rt * Math.sin(f * 3.1 + p.seed)
      - 0.035 * rt * Math.exp(-(f * f) / 0.02);
    top.push([r, f * th]);
  }
  const polar = [...side.map(([r, h]) => [r, a0 - h]), ...top.map(([r, h]) => [r, a0 + h]),
    ...side.slice().reverse().map(([r, h]) => [r, a0 + h])];
  return { pts: polar.map(([r, a]) => [r * Math.cos(a), r * Math.sin(a)]),
    rim: top.map(([r, h]) => [(r - 0.6) * Math.cos(a0 + h), (r - 0.6) * Math.sin(a0 + h)]) };
}

export function drawRose(ctx, g) {
  // g: { R (outer radius mm), r0 (cup base radius mm), k 0..1 (open), t }
  if (g.k <= 0.001) return;
  ctx.save();
  ctx.rotate(0.15 * (1 - smooth(g.k)) + 0.008 * Math.sin(g.t * 0.4));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of ROSE_PETALS) {
    const o = smooth((g.k - p.ring * 0.12) / 0.52); // inner rings open first
    if (o <= 0.001) continue;
    const { pts, rim } = petalPath(g, p, o);
    const fade = smooth(o * 3);
    ctx.globalAlpha = 0.62 * fade;
    ctx.beginPath();
    blob(ctx, pts);
    ctx.fill();
    // light seam along the petal's edge: lets the light through between layers
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.55 * fade;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    rim.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

export { smooth };
