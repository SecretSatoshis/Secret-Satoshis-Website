// Agent 21's face, shared by the homepage hero (js/agent21-hero.js) and the
// Agent 21 app (agent21/components/agent21/agent-avatar.tsx), with its block
// styled by css/agent21-face.css. Types: agent21-face.d.ts.
//
// The face is the Secret Satoshis mark (hero-logo-840.jpg) in its own 840 px
// space: the ₿ lies on its side, its counters are the eyes, its tick marks are
// antenna lights and the logo's smile stays the smile. It is drawn black on
// the orange screen, inside the dark block.

const BODY =
  "M272 276L568 276L568 303L632 303L632 336L570 336L570 374L632 374L632 408L568 408C567 470 540 512 493 512C465 512 445 494 437 477C432 505 405 533 363 533C318 533 272 490 272 415L272 408L206 408L206 374L271 374L271 336L206 336L206 303L272 303Z";
const TICK_LEFT = "M272 221L318 229L318 262Q318 278 334 278L334 284L272 284Z";
const TICK_RIGHT = "M527 222L568 222L568 284L511 284L511 280Q527 280 527 264Z";
const EYES = [
  { x0: 318, x1: 405, y0: 336, y1: 453, ry: 50 },
  { x0: 444, x1: 524, y0: 336, y1: 438, ry: 42 },
];
const CENTER_X = 419;
const CENTER_Y = 426;
const SPAN = 440;
const TAU = Math.PI * 2;
// Animation frames are drawn at about 30 per second, every other frame on a
// 60 Hz screen, which is smooth enough for the face's slow motion.
const FRAME_MS = 30;

/** Below this size the block and screen tighten (the is-small class) and the
 * face fills more of the screen. */
export const SMALL = 56;

/** A word for each state, for status lines beside the avatar. */
export const STATE_LABEL = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  answering: "Answering",
  done: "Ready",
};

// Pose keys that react faster than the default easing.
const FAST = { mouthOpen: 24, eyeOpen: 14, antennaLeft: 16, antennaRight: 16 };

let paths = null;
function facePaths() {
  paths ??= {
    body: new Path2D(BODY),
    left: new Path2D(TICK_LEFT),
    right: new Path2D(TICK_RIGHT),
  };
  return paths;
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const ORANGE = [247, 147, 26];
const INK = [10, 10, 14];
const LIFT = [56, 42, 30];
function mix(a, b, t) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
// A dim feature fades toward the orange screen; the soft top light lifts the
// black slightly.
function ink(v) {
  return v <= 0.85
    ? mix(ORANGE, INK, v / 0.85)
    : mix(INK, LIFT, clamp((v - 0.85) / 0.6, 0, 1));
}

function talk(t) {
  const syllable =
    Math.abs(Math.sin(t * 9.5)) * (0.55 + 0.45 * Math.sin(t * 2.3));
  const pause = Math.sin(t * 0.9) > -0.72 ? 1 : 0;
  return clamp(syllable * 0.85 * pause, 0, 0.9);
}

function targetPose(state, t, look) {
  const { x, y } = look;
  const pose = {
    eyeOpen: 1,
    eyeScale: 1,
    lookX: x * 12,
    lookY: y * 9,
    smileDepth: 1,
    smileWidth: 1,
    smileShift: 0,
    mouthOpen: 0,
    antennaLeft: 1,
    antennaRight: 1,
    brightness: 1,
    ripple: 0,
    glint: 0,
    offsetX: x * 0.5,
    offsetY: y * 0.4,
  };
  switch (state) {
    case "listening": {
      const pulse = 0.62 + 0.38 * Math.sin(t * 3.2);
      return {
        ...pose,
        eyeScale: 1.1,
        lookX: x * 5,
        lookY: y * 4,
        offsetX: x * 0.25,
        offsetY: y * 0.2,
        smileDepth: 0.8,
        ripple: 1,
        antennaLeft: pulse,
        antennaRight: pulse,
      };
    }
    case "thinking": {
      const left = Math.sin(t * 6.5) > 0;
      return {
        ...pose,
        lookX: 9 + 3 * Math.sin(t * 0.9),
        lookY: -12,
        eyeOpen: 0.8,
        smileDepth: 0.28,
        smileWidth: 0.72,
        smileShift: 22,
        offsetX: 0.25,
        offsetY: -0.2,
        glint: 1,
        antennaLeft: left ? 1 : 0.18,
        antennaRight: left ? 0.18 : 1,
      };
    }
    case "answering":
      return {
        ...pose,
        lookX: x * 4,
        lookY: y * 3 + 2,
        offsetX: x * 0.2,
        offsetY: y * 0.15,
        mouthOpen: talk(t),
        smileDepth: 0.9,
      };
    // Completed answers return to the default pose on both sites.
    default:
      return pose;
  }
}

// The changing shapes are traced straight onto the canvas each frame, not
// built as Path2D objects.
function eyeShape(e, p) {
  const h0 = e.y1 - e.y0;
  const w = (e.x1 - e.x0) * p.eyeScale;
  const cx = (e.x0 + e.x1) / 2 + p.lookX;
  const h = Math.max(h0 * p.eyeScale * p.eyeOpen, 30);
  const yc = e.y0 + h0 * 0.55 + p.lookY;
  const top = yc - h * 0.55;
  const bottom = yc + h * 0.45;
  const ry = Math.max(Math.min(e.ry * (h / h0), h * 0.9), 0.5);
  return { cx, w, top, bottom, h, ry };
}

function traceEye(ctx, e) {
  ctx.beginPath();
  ctx.moveTo(e.cx - e.w / 2, e.top);
  ctx.lineTo(e.cx + e.w / 2, e.top);
  ctx.lineTo(e.cx + e.w / 2, e.bottom - e.ry);
  ctx.ellipse(e.cx, e.bottom - e.ry, e.w / 2, e.ry, 0, 0, Math.PI);
  ctx.closePath();
}

function mouthShape(p) {
  const half = 148 * p.smileWidth;
  const cx = 418 + p.smileShift;
  const ey = 566;
  return { cx, ey, x0: cx - half, x1: cx + half, cy: ey + 124 * p.smileDepth };
}

function traceMouth(ctx, m, open) {
  ctx.beginPath();
  ctx.moveTo(m.x0, m.ey);
  ctx.quadraticCurveTo(m.cx, m.cy, m.x1, m.ey);
  if (open > 0.02) {
    ctx.quadraticCurveTo(m.cx, m.cy + open * 170, m.x0, m.ey);
    ctx.closePath();
  }
}

function traceDimples(ctx, m) {
  ctx.beginPath();
  ctx.moveTo(m.x0 - 17, m.ey + 8);
  ctx.quadraticCurveTo(m.x0 - 20, m.ey - 14, m.x0 + 2, m.ey - 15);
  ctx.moveTo(m.x1 + 17, m.ey + 8);
  ctx.quadraticCurveTo(m.x1 + 20, m.ey - 14, m.x1 - 2, m.ey - 15);
}

function draw(ctx, px, size, p, t, dpr) {
  const large = size >= SMALL;
  const { body, left, right } = facePaths();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, px, px);

  // Listening: rings move out from behind the face.
  if (p.ripple > 0.01 && large) {
    const progress = (t * 0.42) % 1;
    ctx.lineWidth = px * 0.016;
    for (const q of [progress, (progress + 0.5) % 1]) {
      ctx.strokeStyle = `rgba(10,10,14,${(0.5 * p.ripple * (1 - q)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, px * (0.14 + 0.42 * q), 0, TAU);
      ctx.stroke();
    }
  }

  const k = (px * (large ? 0.8 : 0.92)) / SPAN;
  const shift = px * 0.024;
  ctx.setTransform(
    k,
    0,
    0,
    k,
    px / 2 + p.offsetX * shift - CENTER_X * k,
    px / 2 + p.offsetY * shift - CENTER_Y * k,
  );
  const b = p.brightness;
  // A soft top light: brighter at the antennae, deeper at the smile.
  const fill = ctx.createLinearGradient(0, 221, 0, 630);
  fill.addColorStop(0, ink(b * 1.14));
  fill.addColorStop(0.5, ink(b));
  fill.addColorStop(1, ink(b * 0.86));

  ctx.fillStyle = ink(b * 1.14 * p.antennaLeft);
  ctx.fill(left);
  ctx.fillStyle = ink(b * 1.14 * p.antennaRight);
  ctx.fill(right);
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.fill(body);

  const stroke = Math.max(15, ((large ? 1.2 : 1.5) * dpr) / k);
  const mouth = mouthShape(p);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke;
  traceMouth(ctx, mouth, p.mouthOpen);
  ctx.stroke();
  const dimple = ease(0.5, 0.95, p.smileDepth) * (1 - p.mouthOpen * 0.7);
  if (dimple > 0.01) {
    ctx.globalAlpha = dimple;
    ctx.lineWidth = stroke * 0.8;
    traceDimples(ctx, mouth);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const eyes = EYES.map((e) => eyeShape(e, p));
  ctx.globalCompositeOperation = "destination-out";
  for (const e of eyes) {
    traceEye(ctx, e);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  // Thinking: a glint sweeps across the face.
  if (p.glint > 0.01) {
    const pos = ((t * 0.55) % 1.6) - 0.3;
    const glint = ctx.createLinearGradient(199, 206, 639, 646);
    const stop = (o, a) =>
      glint.addColorStop(clamp(o, 0, 1), `rgba(255,190,110,${a.toFixed(3)})`);
    stop(pos - 0.09, 0);
    stop(pos, 0.6 * p.glint);
    stop(pos + 0.09, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = glint;
    ctx.fillRect(150, 150, 540, 540);
    ctx.globalCompositeOperation = "source-over";
  }
}

/**
 * Draws Agent 21 on `canvas` inside `root` (the a21-agent block) and animates
 * it while it is on screen: it blinks, wanders or follows the cursor, and with
 * `float` the block bobs and tilts. Without a `size` it measures `root`, whose
 * size then comes from CSS, and redraws when that changes. With reduced motion
 * it shows one still pose per state.
 */
export function mountAgent(root, canvas, options = {}) {
  const { size, followPointer = false, float = false } = options;
  let state = options.state ?? "idle";
  const ctx = canvas.getContext("2d");
  if (!ctx) return { setState() {}, destroy() {} };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let s = 0;
  let px = 0;
  // Sizes the canvas to the block; true when the size changed.
  const fit = () => {
    const next = size ?? root.offsetWidth;
    if (!next || next === s) return false;
    s = next;
    px = Math.max(8, Math.round(s * (s >= SMALL ? 0.82 : 0.86) * dpr));
    canvas.width = canvas.height = px;
    return true;
  };
  fit();

  const phase = Math.random() * 100;
  const look = { x: 0, y: 0, tx: 0, ty: 0, last: -10 };
  const pose = targetPose(state, 0, look);
  let nextBlink = 1.4 + Math.random() * 2;
  let blinks = [];
  let frame = 0;
  // Back-dated so the first frame draws at once.
  let last = performance.now() - FRAME_MS;
  let visible = true;

  // One still pose per state, no blinking, wandering or bobbing.
  const still = () => {
    if (!s) return;
    const target = targetPose(state, 0, look);
    if (state === "answering") target.mouthOpen = 0.3;
    draw(ctx, px, s, target, 0, dpr);
    root.style.setProperty("--glow", (0.3 * target.brightness).toFixed(3));
  };
  // Resizing clears the canvas, so the new size is drawn at once.
  const resized =
    size === undefined
      ? new ResizeObserver(() => {
          if (!fit()) return;
          if (reduced) still();
          else draw(ctx, px, s, pose, performance.now() / 1000, dpr);
        })
      : null;
  resized?.observe(root);

  if (reduced) {
    still();
    return {
      setState(next) {
        state = next;
        still();
      },
      destroy() {
        resized?.disconnect();
      },
    };
  }

  const blinkFactor = (t) => {
    if (t > nextBlink) {
      blinks = Math.random() < 0.22 ? [t, t + 0.26] : [t];
      nextBlink = t + 2.6 + Math.random() * 3.4;
    }
    let f = 1;
    for (const start of blinks) {
      const x = (t - start) / 0.17;
      if (x >= 0 && x <= 1) f = Math.min(f, 1 - Math.sin(x * Math.PI));
    }
    return f;
  };

  const onPointer = (e) => {
    const r = root.getBoundingClientRect();
    look.tx = clamp(
      (e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.45),
      -1,
      1,
    );
    look.ty = clamp(
      (e.clientY - (r.top + r.height / 2)) / (window.innerHeight * 0.45),
      -1,
      1,
    );
    look.last = performance.now() / 1000;
  };

  const tick = (now) => {
    frame = visible ? requestAnimationFrame(tick) : 0;
    if (now - last < FRAME_MS) return;
    const t = now / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Wander when nobody is pointing.
    if (t - look.last > 3) {
      const w = t + phase;
      look.tx = 0.55 * Math.sin(w * 0.31) + 0.25 * Math.sin(w * 0.83);
      look.ty = 0.35 * Math.sin(w * 0.47 + 1);
    }
    const lk = 1 - Math.exp(-dt * 6);
    look.x += (look.tx - look.x) * lk;
    look.y += (look.ty - look.y) * lk;

    const target = targetPose(state, t, look);
    for (const key of Object.keys(target)) {
      const rate = FAST[key] ?? 8;
      pose[key] += (target[key] - pose[key]) * (1 - Math.exp(-dt * rate));
    }
    if (s) {
      draw(
        ctx,
        px,
        s,
        { ...pose, eyeOpen: pose.eyeOpen * blinkFactor(t) },
        t,
        dpr,
      );
      root.style.setProperty("--glow", (0.3 * pose.brightness).toFixed(3));
      if (float) {
        const lift = Math.sin(t * 1.6) * s * 0.013;
        root.style.transform = `perspective(${s * 3}px) rotateY(${(look.x * 12).toFixed(2)}deg) rotateX(${(-look.y * 9).toFixed(2)}deg) translateY(${lift.toFixed(2)}px)`;
      }
    }
  };

  if (followPointer) {
    window.addEventListener("pointermove", onPointer, { passive: true });
  }
  const shown = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !frame) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  });
  shown.observe(root);
  frame = requestAnimationFrame(tick);

  return {
    setState(next) {
      if (next === state) return;
      state = next;
    },
    destroy() {
      cancelAnimationFrame(frame);
      shown.disconnect();
      resized?.disconnect();
      window.removeEventListener("pointermove", onPointer);
    },
  };
}
