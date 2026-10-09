"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./agent-avatar.module.css";

export type AgentState =
  "idle" | "listening" | "thinking" | "answering" | "done";

/** A word for each state, for status lines beside the avatar. */
export const STATE_LABEL: Record<AgentState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  answering: "Answering",
  done: "Answered",
};

// Face geometry in the 840 px space of the Secret Satoshis mark (hero-logo-840.jpg).
// The ₿ lies on its side: its counters are the eyes and its tick marks are antenna lights.
// It is drawn in the mark's own colors, black on Bitcoin orange, inside the dark block.
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
// Below this size the shell and screen tighten and the face fills more of the screen.
const SMALL = 56;

type Pose = {
  eyeOpen: number;
  eyeScale: number;
  lookX: number;
  lookY: number;
  squint: number;
  smileDepth: number;
  smileWidth: number;
  smileShift: number;
  mouthOpen: number;
  antennaLeft: number;
  antennaRight: number;
  brightness: number;
  ripple: number;
  glint: number;
  offsetX: number;
  offsetY: number;
};

// Pose keys that must react faster than the default easing.
const FAST: Partial<Record<keyof Pose, number>> = {
  mouthOpen: 24,
  eyeOpen: 14,
  antennaLeft: 16,
  antennaRight: 16,
};

let paths: { body: Path2D; left: Path2D; right: Path2D } | null = null;
function facePaths() {
  paths ??= {
    body: new Path2D(BODY),
    left: new Path2D(TICK_LEFT),
    right: new Path2D(TICK_RIGHT),
  };
  return paths;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ease = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const ORANGE = [247, 147, 26];
const INK = [10, 10, 14];
const LIFT = [56, 42, 30];
function mix(a: number[], b: number[], t: number) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
// A dim feature fades toward the orange screen; the soft top light lifts the
// black slightly.
function ink(v: number) {
  return v <= 0.85
    ? mix(ORANGE, INK, v / 0.85)
    : mix(INK, LIFT, clamp((v - 0.85) / 0.6, 0, 1));
}

function talk(t: number) {
  const syllable =
    Math.abs(Math.sin(t * 9.5)) * (0.55 + 0.45 * Math.sin(t * 2.3));
  const pause = Math.sin(t * 0.9) > -0.72 ? 1 : 0;
  return clamp(syllable * 0.85 * pause, 0, 0.9);
}

function targetPose(
  state: AgentState,
  t: number,
  look: { x: number; y: number },
): Pose {
  const { x, y } = look;
  const pose: Pose = {
    eyeOpen: 1,
    eyeScale: 1,
    lookX: x * 12,
    lookY: y * 9,
    squint: 0,
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
    case "done":
      return {
        ...pose,
        squint: 1,
        smileDepth: 1.25,
        smileWidth: 1.06,
        brightness: 1.08,
        lookX: x * 4,
        lookY: y * 3,
      };
    default:
      return pose;
  }
}

function eyeShape(e: (typeof EYES)[number], p: Pose) {
  const h0 = e.y1 - e.y0;
  const w = (e.x1 - e.x0) * p.eyeScale;
  const cx = (e.x0 + e.x1) / 2 + p.lookX;
  const h = Math.max(h0 * p.eyeScale * p.eyeOpen, 30);
  const yc = e.y0 + h0 * 0.55 + p.lookY;
  const top = yc - h * 0.55;
  const bottom = yc + h * 0.45;
  const ry = Math.max(Math.min(e.ry * (h / h0), h * 0.9), 0.5);
  const path = new Path2D();
  path.moveTo(cx - w / 2, top);
  path.lineTo(cx + w / 2, top);
  path.lineTo(cx + w / 2, bottom - ry);
  path.ellipse(cx, bottom - ry, w / 2, ry, 0, 0, Math.PI);
  path.closePath();
  return { path, cx, w, bottom, h };
}

function mouthShapes(p: Pose) {
  const half = 148 * p.smileWidth;
  const cx = 418 + p.smileShift;
  const ey = 566;
  const x0 = cx - half;
  const x1 = cx + half;
  const cy = ey + 124 * p.smileDepth;
  const mouth = new Path2D();
  mouth.moveTo(x0, ey);
  mouth.quadraticCurveTo(cx, cy, x1, ey);
  if (p.mouthOpen > 0.02) {
    mouth.quadraticCurveTo(cx, cy + p.mouthOpen * 170, x0, ey);
    mouth.closePath();
  }
  const dimples = new Path2D();
  dimples.moveTo(x0 - 17, ey + 8);
  dimples.quadraticCurveTo(x0 - 20, ey - 14, x0 + 2, ey - 15);
  dimples.moveTo(x1 + 17, ey + 8);
  dimples.quadraticCurveTo(x1 + 20, ey - 14, x1 - 2, ey - 15);
  return { mouth, dimples };
}

function draw(
  ctx: CanvasRenderingContext2D,
  px: number,
  size: number,
  p: Pose,
  t: number,
  dpr: number,
) {
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
  const { mouth, dimples } = mouthShapes(p);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke;
  ctx.stroke(mouth);
  const dimple = ease(0.5, 0.95, p.smileDepth) * (1 - p.mouthOpen * 0.7);
  if (dimple > 0.01) {
    ctx.globalAlpha = dimple;
    ctx.lineWidth = stroke * 0.8;
    ctx.stroke(dimples);
    ctx.globalAlpha = 1;
  }

  const eyes = EYES.map((e) => eyeShape(e, p));
  ctx.globalCompositeOperation = "destination-out";
  for (const e of eyes) ctx.fill(e.path);
  ctx.globalCompositeOperation = "source-over";
  // Done: the cheeks push up and the eyes become smiling arches.
  if (p.squint > 0.01) {
    for (const e of eyes) {
      ctx.save();
      ctx.clip(e.path);
      ctx.beginPath();
      ctx.ellipse(
        e.cx,
        e.bottom + e.h * 0.25,
        e.w * 0.62,
        e.h * 0.62 * p.squint,
        0,
        0,
        TAU,
      );
      ctx.fill();
      ctx.restore();
    }
  }

  // Thinking: a glint sweeps across the face.
  if (p.glint > 0.01) {
    const pos = ((t * 0.55) % 1.6) - 0.3;
    const glint = ctx.createLinearGradient(199, 206, 639, 646);
    const stop = (o: number, a: number) =>
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

export function AgentAvatar({
  state = "idle",
  size,
  followPointer = false,
  float = false,
}: {
  state?: AgentState;
  /** Width and height in CSS pixels. Without it the avatar takes its size
   * from a `--s` set in CSS, so the server renders it at its final size. */
  size?: number;
  /** Eyes (and, with `float`, the block) turn toward the cursor. */
  followPointer?: boolean;
  /** Gentle bob and tilt, for hero placements. */
  float?: boolean;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState(0);
  const s = size ?? measured;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const changedAtRef = useRef(0);
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
    changedAtRef.current = performance.now() / 1000;
    redrawRef.current?.();
  }, [state]);

  // A CSS-sized avatar is measured before its first paint, then redrawn at
  // whatever size its layout gives it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (size !== undefined || !root) return;
    setMeasured(root.offsetWidth);
    const observer = new ResizeObserver(() => setMeasured(root.offsetWidth));
    observer.observe(root);
    return () => observer.disconnect();
  }, [size]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!root || !canvas || !ctx || !s) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(8, Math.round(s * (s >= SMALL ? 0.82 : 0.86) * dpr));
    canvas.width = canvas.height = px;

    const phase = Math.random() * 100;
    const look = { x: 0, y: 0, tx: 0, ty: 0, last: -10 };
    const pose = targetPose(stateRef.current, 0, look);
    let nextBlink = 1.4 + Math.random() * 2;
    let blinks: number[] = [];
    let frame = 0;
    let last = performance.now();
    let visible = true;

    const blinkFactor = (t: number) => {
      if (t > nextBlink) {
        blinks = Math.random() < 0.22 ? [t, t + 0.26] : [t];
        nextBlink = t + 2.6 + Math.random() * 3.4;
      }
      let f = 1;
      for (const s of blinks) {
        const x = (t - s) / 0.17;
        if (x >= 0 && x <= 1) f = Math.min(f, 1 - Math.sin(x * Math.PI));
      }
      return f;
    };

    const onPointer = (e: PointerEvent) => {
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

    const tick = (now: number) => {
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

      const target = targetPose(stateRef.current, t, look);
      for (const key of Object.keys(target) as (keyof Pose)[]) {
        const rate = FAST[key] ?? 8;
        pose[key] += (target[key] - pose[key]) * (1 - Math.exp(-dt * rate));
      }
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
        const since = t - changedAtRef.current;
        const hop =
          stateRef.current === "done"
            ? -0.05 * s * Math.abs(Math.sin(since * 7)) * Math.exp(-since * 2.6)
            : 0;
        const lift = hop + Math.sin(t * 1.6) * s * 0.013;
        root.style.transform = `perspective(${s * 3}px) rotateY(${(look.x * 12).toFixed(2)}deg) rotateX(${(-look.y * 9).toFixed(2)}deg) translateY(${lift.toFixed(2)}px)`;
      }
      frame = visible ? requestAnimationFrame(tick) : 0;
    };

    if (reduced) {
      // One still pose per state, no blinking, wandering or bobbing.
      redrawRef.current = () => {
        const target = targetPose(stateRef.current, 0, look);
        if (stateRef.current === "answering") target.mouthOpen = 0.3;
        draw(ctx, px, s, target, 0, dpr);
        root.style.setProperty("--glow", (0.3 * target.brightness).toFixed(3));
      };
      redrawRef.current();
      return () => {
        redrawRef.current = null;
      };
    }

    if (followPointer) {
      window.addEventListener("pointermove", onPointer, { passive: true });
    }
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    });
    io.observe(root);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
    };
  }, [s, followPointer, float]);

  return (
    <span
      ref={rootRef}
      className={
        s && s < SMALL ? `${styles.root} ${styles.small}` : styles.root
      }
      style={
        size === undefined
          ? undefined
          : ({ "--s": `${size}px` } as React.CSSProperties)
      }
      aria-hidden="true"
    >
      <span className={styles.shell} />
      <span className={styles.screen}>
        <canvas ref={canvasRef} />
      </span>
    </span>
  );
}
