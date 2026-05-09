"use client";

import confetti from "canvas-confetti";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { HOLD_KIND_FILL, HOLD_KIND_RULES } from "@/lib/route-defs";

// =============================================================================
// Klifur — physics climbing puzzle
//
// Body model:
//   Verlet particles for chest, pelvis, shL/R, elL/R, hL/R, hipL/R, knL/R, fL/R.
//   The HEAD is NOT a verlet particle; it is computed each frame from the
//   pelvis→chest direction, so it never dangles.
//
// Init pose:
//   - Both hands on the START hold (offset L/R)
//   - Body hanging below
//   - Auto-pick the two closest holds within foot-reach below the body
//     and grip both feet to them. (Falls back to dangling feet if no
//     suitable holds exist.)
//
// Hold rules:
//   start, finish, jug    — any limb may grip indefinitely
//   crimp                 — only HANDS may grip; feet slip off if dropped
//   sloper                — any limb but auto-releases after 4 s
// =============================================================================

const GRAVITY = 0.55;
const FRICTION = 0.82;          // heavy damping → no bouncing
const MAX_PARTICLE_SPEED = 22;  // px per frame; kills explosive constraint bounces
const SOLVER_ITERS = 18;
const FALL_GRACE_MS = 250;
const SETTLE_ITERS = 100;       // pre-render constraint iterations

// Skeleton dimensions — every distance below is *consistent* with how the
// particles are initially placed in makeClimber(), otherwise constraints
// fight each other and the body wobbles like jelly.
const L = {
  neck: 22,
  spine: 56,
  shoulderHalf: 19,                 // chest ↔ each shoulder  (so shL↔shR = 38)
  hipHalf: 16,                      // pelvis ↔ each hip       (so hipL↔hipR = 32)
  upperArm: 36,
  forearm: 38,
  thigh: 44,
  shin: 46,
};
// Pre-computed rest distances for the rigid torso quad
const D = {
  shoulderWidth: 2 * L.shoulderHalf,                                 // 38
  hipWidth: 2 * L.hipHalf,                                           // 32
  shToPelvis: Math.hypot(L.shoulderHalf, L.spine),                   // ≈ 59.1
  shToHipNear: Math.hypot(L.shoulderHalf - L.hipHalf, L.spine),      // ≈ 56.1
  shToHipFar: Math.hypot(L.shoulderHalf + L.hipHalf, L.spine),       // ≈ 66.0
  hipToChest: Math.hypot(L.hipHalf, L.spine),                        // ≈ 58.2
};
const ARM_LEN = L.shoulderHalf + L.upperArm + L.forearm; // 93
const LEG_LEN = L.hipHalf + L.thigh + L.shin;            // 106
// Drag controls how fast the cursor TARGET pulls a limb. The base speed is
// the "no-effort" pace; an effort multiplier slows the limb down when it is
// nearing its maximum reach, so the last bit of stretch feels strenuous —
// like a real climber straining to reach a far hold.
const DRAG_FOLLOW_SPEED = 320;   // px / second at low effort
const EFFORT_FREE_RATIO = 0.45;  // up to this fraction of max reach: full speed
const EFFORT_FLOOR = 0.28;       // never less than 28% of full speed
const EFFORT_CURVE = 1.9;        // higher → harder slowdown near full extension

// Strict reach equal to the bone-chain length — no elastic slack, so when the
// solver pulls things back it never has to compress an over-stretched limb.
const HAND_MAX_REACH = ARM_LEN;
const FOOT_MAX_REACH = LEG_LEN;
const FOOT_LIMBS = ["LF", "RF"];
const LEG_EXTENSION_DIST = (L.thigh + L.shin) * 0.94;
const PELVIS_EXTENSION_DIST = Math.hypot(L.hipHalf, LEG_EXTENSION_DIST);
const LEG_DRIVE_STIFFNESS = 0.55;
const MIN_LOAD_FOOT_SCORE = 0.08;

const HAND_TAPE = { LH: "#7c3aed", RH: "#dc2626" };

// Stamina drain per second while gripping each kind of hold (base rate).
//   start/finish are easy "rest" holds; jug slow; sloper medium; crimp fast.
const STAMINA_DRAIN = {
  start: 0.025, finish: 0.025,
  jug: 0.045, sloper: 0.18, crimp: 0.32,
};
// Distribution multiplier — fewer supports means each remaining limb carries
// more body weight. Indexed by current grip count (0..4).
//   4 grips → effectively rests; 1 grip → tires very fast.
const STAMINA_DIST_MULT = [0, 2.8, 1.5, 0.8, 0.35];
const STAMINA_RECOVERY = 0.4;        // per second while limb is free
const FOOT_DRAIN_MULT = 0.5;         // legs are stronger than fingers
const STAMINA_LIMB_LABEL = { LH: "左手", RH: "右手", LF: "左脚", RF: "右脚" };
const STAMINA_LIMB_COLOR = {
  LH: "#7c3aed", RH: "#dc2626", LF: "#16a34a", RF: "#0284c7",
};
const CONFETTI_COLORS = ["#f97316", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#facc15"];

// --- Verlet helpers ---
function P(x, y) { return { x, y, px: x, py: y, pinned: false }; }
function step(p) {
  if (p.pinned) { p.px = p.x; p.py = p.y; return; }
  let vx = (p.x - p.px) * FRICTION;
  let vy = (p.y - p.py) * FRICTION;
  // Clamp velocity to keep constraint corrections from injecting bouncy energy
  const speed = Math.hypot(vx, vy);
  if (speed > MAX_PARTICLE_SPEED) {
    vx = (vx / speed) * MAX_PARTICLE_SPEED;
    vy = (vy / speed) * MAX_PARTICLE_SPEED;
  }
  p.px = p.x; p.py = p.y;
  p.x += vx; p.y += vy + GRAVITY;
}
function constrain(a, b, rest, stiff = 1) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1e-4;
  const diff = ((d - rest) / d) * stiff * 0.5;
  if (!a.pinned) { a.x += dx * diff; a.y += dy * diff; }
  if (!b.pinned) { b.x -= dx * diff; b.y -= dy * diff; }
}
function extendOnly(a, b, rest, stiff = 1) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1e-4;
  if (d >= rest) return;
  const diff = ((d - rest) / d) * stiff * 0.5;
  if (!a.pinned) { a.x += dx * diff; a.y += dy * diff; }
  if (!b.pinned) { b.x -= dx * diff; b.y -= dy * diff; }
}

const ALL_PARTICLES = [
  "chest","pelvis","shL","shR","elL","elR","hL","hR","hipL","hipR","knL","knR","fL","fR",
];

const LIMB_HANDLES = {
  LH: { end: "hL", anchor: "chest", maxReach: HAND_MAX_REACH, kind: "hand" },
  RH: { end: "hR", anchor: "chest", maxReach: HAND_MAX_REACH, kind: "hand" },
  LF: { end: "fL", anchor: "pelvis", maxReach: FOOT_MAX_REACH, kind: "foot" },
  RF: { end: "fR", anchor: "pelvis", maxReach: FOOT_MAX_REACH, kind: "foot" },
};

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function footHipPart(limb) {
  return limb === "LF" ? "hipL" : "hipR";
}

function lowerBodySupport(c, holdById) {
  const feet = [];
  const p = c.parts;
  for (const limb of FOOT_LIMBS) {
    const id = c.grips[limb];
    const hold = id ? holdById.get(id) : null;
    if (!hold) continue;
    const kind = hold.kind === "hold" ? "jug" : hold.kind;
    if (!HOLD_KIND_RULES[kind]?.feetCan) continue;

    const foot = p[LIMB_HANDLES[limb].end];
    const hip = p[footHipPart(limb)];
    const dx = foot.x - hip.x;
    const dy = foot.y - hip.y;
    const dist = Math.hypot(dx, dy);

    // Feet only push the body up when they are below/near the hip and the leg
    // still has extension room. A high or over-extended foot is a grip, not a
    // stance.
    const belowHip = clamp01((dy + 28) / (LEG_EXTENSION_DIST * 0.75));
    const notTooLow = clamp01((LEG_EXTENSION_DIST * 1.12 - dy) / (LEG_EXTENSION_DIST * 0.35));
    const centered = clamp01(1 - Math.abs(dx) / (LEG_EXTENSION_DIST * 1.55));
    const bendRoom = clamp01((LEG_EXTENSION_DIST * 1.06 - dist) / (LEG_EXTENSION_DIST * 0.75));
    const score = belowHip * notTooLow * centered * (0.45 + bendRoom * 0.55) * c.stamina[limb];
    if (score <= 0.04) continue;
    feet.push({ limb, score, dist });
  }
  return {
    feet,
    score: clamp01(feet.reduce((sum, foot) => sum + foot.score, 0)),
  };
}

function applyLegDriveConstraints(c, support, strength) {
  if (!support || support.feet.length === 0 || strength <= 0) return;
  const p = c.parts;
  for (const footSupport of support.feet) {
    const limb = footSupport.limb;
    const foot = p[LIMB_HANDLES[limb].end];
    const hip = p[footHipPart(limb)];
    const stiffness = LEG_DRIVE_STIFFNESS * strength * footSupport.score;
    extendOnly(hip, foot, LEG_EXTENSION_DIST, stiffness);
    extendOnly(p.pelvis, foot, PELVIS_EXTENSION_DIST, stiffness * 0.65);
  }
}

function makeClimber(centerX, hipY) {
  const cx = centerX;
  const pelvis = P(cx, hipY);
  const chest = P(cx, hipY - L.spine);
  const shL = P(cx - L.shoulderHalf, chest.y);
  const shR = P(cx + L.shoulderHalf, chest.y);
  const elL = P(shL.x - 8, shL.y + 28);
  const elR = P(shR.x + 8, shR.y + 28);
  const hL = P(elL.x - 4, elL.y + L.forearm);
  const hR = P(elR.x + 4, elR.y + L.forearm);
  const hipL = P(cx - L.hipHalf, hipY);
  const hipR = P(cx + L.hipHalf, hipY);
  const knL = P(hipL.x - 6, hipL.y + L.thigh);
  const knR = P(hipR.x + 6, hipR.y + L.thigh);
  const fL = P(knL.x - 2, knL.y + L.shin);
  const fR = P(knR.x + 2, knR.y + L.shin);
  return {
    parts: { chest, pelvis, shL, shR, elL, elR, hL, hR, hipL, hipR, knL, knR, fL, fR },
    grips: { LH: null, RH: null, LF: null, RF: null }, // hold ids
    // Offset from hold-center where each limb actually grips. Stored when the
    // grip is made so the limb does NOT snap to the hold's center every frame.
    gripOffset: { LH: { x: 0, y: 0 }, RH: { x: 0, y: 0 }, LF: { x: 0, y: 0 }, RF: { x: 0, y: 0 } },
    gripStartedAt: { LH: 0, RH: 0, LF: 0, RF: 0 },
    stamina: { LH: 1, RH: 1, LF: 1, RF: 1 },
  };
}

function applyConstraints(c) {
  const p = c.parts;
  // === Torso skeleton — fully rigid quad with all braces. ===
  // Spine
  constrain(p.chest, p.pelvis, L.spine);
  // Shoulders & hips horizontal bars
  constrain(p.shL, p.shR, D.shoulderWidth);
  constrain(p.hipL, p.hipR, D.hipWidth);
  // Chest is the midpoint between shoulders (degenerate but consistent)
  constrain(p.chest, p.shL, L.shoulderHalf);
  constrain(p.chest, p.shR, L.shoulderHalf);
  constrain(p.pelvis, p.hipL, L.hipHalf);
  constrain(p.pelvis, p.hipR, L.hipHalf);
  // Side connections (left torso side, right torso side) — keep length rigid
  constrain(p.shL, p.hipL, D.shToHipNear);
  constrain(p.shR, p.hipR, D.shToHipNear);
  // Cross diagonals — these are what stop the torso from shearing
  constrain(p.shL, p.hipR, D.shToHipFar);
  constrain(p.shR, p.hipL, D.shToHipFar);
  // Extra bracing: shoulders ↔ pelvis, hips ↔ chest
  constrain(p.shL, p.pelvis, D.shToPelvis);
  constrain(p.shR, p.pelvis, D.shToPelvis);
  constrain(p.hipL, p.chest, D.hipToChest);
  constrain(p.hipR, p.chest, D.hipToChest);
  // === Limb chains (rigid bone lengths) ===
  constrain(p.shL, p.elL, L.upperArm);
  constrain(p.elL, p.hL, L.forearm);
  constrain(p.shR, p.elR, L.upperArm);
  constrain(p.elR, p.hR, L.forearm);
  constrain(p.hipL, p.knL, L.thigh);
  constrain(p.knL, p.fL, L.shin);
  constrain(p.hipR, p.knR, L.thigh);
  constrain(p.knR, p.fR, L.shin);
}

// Compute head position from torso direction (so head never dangles).
function headAnchor(parts) {
  const dx = parts.chest.x - parts.pelvis.x;
  const dy = parts.chest.y - parts.pelvis.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  return {
    x: parts.chest.x + ux * (L.neck + 6),
    y: parts.chest.y + uy * (L.neck + 6),
    upX: ux, upY: uy,
  };
}

// --- Hold hashing & polygons (deterministic blob shape from id) ---
function hash01(s, i) {
  let h = 2166136261 >>> 0;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  h = Math.imul(h ^ i, 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function holdBlob(hold, points = 11, jitter = 0.6) {
  const out = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const wobble = 1 - jitter / 2 + hash01(hold.id, i) * jitter;
    const r = hold.size * wobble;
    out.push({ x: hold.x + Math.cos(a) * r, y: hold.y + Math.sin(a) * r * 0.85 });
  }
  return out;
}

function drawHold(ctx, hold, opts = {}) {
  const kind = hold.kind === "hold" ? "jug" : hold.kind;
  const [base, dark] = HOLD_KIND_FILL[kind] || HOLD_KIND_FILL.jug;

  // shadow
  ctx.save();
  ctx.translate(2, 4);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  if (kind === "crimp") {
    drawCrimpShape(ctx, hold);
  } else if (kind === "sloper") {
    drawSloperShape(ctx, hold);
  } else {
    const poly = holdBlob(hold);
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (const p of poly) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  if (kind === "crimp") {
    // Tiny dark horizontal edge — small lip you crimp with fingertips
    ctx.fillStyle = base;
    drawCrimpShape(ctx, hold);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.2;
    drawCrimpShape(ctx, hold); ctx.stroke();
    // accent stripe (the gripping edge)
    ctx.fillStyle = dark;
    ctx.fillRect(hold.x - hold.size * 0.85, hold.y - hold.size * 0.1, hold.size * 1.7, hold.size * 0.15);
  } else if (kind === "sloper") {
    // Smooth round dome with radial gradient
    const grd = ctx.createRadialGradient(
      hold.x - hold.size * 0.3, hold.y - hold.size * 0.4, hold.size * 0.1,
      hold.x, hold.y, hold.size,
    );
    grd.addColorStop(0, "#fbe9c8");
    grd.addColorStop(0.6, base);
    grd.addColorStop(1, dark);
    ctx.fillStyle = grd;
    drawSloperShape(ctx, hold); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.2;
    drawSloperShape(ctx, hold); ctx.stroke();
  } else {
    const poly = holdBlob(hold);
    // body
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (const p of poly) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
    // shaded lower half
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (const p of poly) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = dark;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(hold.x - hold.size, hold.y, hold.size * 2, hold.size);
    ctx.restore();
    // outline
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (const p of poly) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.stroke();
    // bolt mark
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.arc(hold.x + hold.size * 0.05, hold.y - hold.size * 0.05,
            Math.max(2, hold.size * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }

  // Route label tape stripes for start/finish
  if (kind === "start" || kind === "finish") {
    const stripeColors = kind === "start"
      ? ["#22c55e", "#3b82f6", "#a855f7", "#facc15"]
      : ["#ef4444", "#f59e0b", "#a855f7", "#22c55e"];
    ctx.save();
    ctx.translate(hold.x, hold.y - hold.size - 4);
    for (let i = 0; i < stripeColors.length; i++) {
      ctx.fillStyle = stripeColors[i];
      const dx = (i - (stripeColors.length - 1) / 2) * 4;
      ctx.fillRect(dx - 1.5, -10 - i * 2, 3, 12);
    }
    ctx.restore();
  }

  // Sloper grip-timer overlay (countdown ring)
  if (opts.slipProgress != null && opts.slipProgress > 0 && opts.slipProgress < 1) {
    ctx.strokeStyle = "rgba(220,38,38,0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(hold.x, hold.y, hold.size + 4,
            -Math.PI / 2,
            -Math.PI / 2 + Math.PI * 2 * (1 - opts.slipProgress));
    ctx.stroke();
  }

  // Drag hover highlight
  if (opts.highlight) {
    ctx.strokeStyle = "rgba(245,158,11,0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(hold.x, hold.y, hold.size + 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (opts.rejected) {
    // out of reach / wrong limb type — clear "no" indicator
    ctx.strokeStyle = "rgba(220,38,38,0.95)";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    const r = hold.size + 8;
    ctx.beginPath();
    ctx.arc(hold.x, hold.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    const k = r * 0.7;
    ctx.moveTo(hold.x - k, hold.y - k);
    ctx.lineTo(hold.x + k, hold.y + k);
    ctx.moveTo(hold.x + k, hold.y - k);
    ctx.lineTo(hold.x - k, hold.y + k);
    ctx.stroke();
  }
}

function drawCrimpShape(ctx, hold) {
  // small horizontal pill
  const w = hold.size * 1.7, h = hold.size * 0.55;
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(hold.x - w / 2 + r, hold.y - h / 2);
  ctx.lineTo(hold.x + w / 2 - r, hold.y - h / 2);
  ctx.arc(hold.x + w / 2 - r, hold.y, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(hold.x - w / 2 + r, hold.y + h / 2);
  ctx.arc(hold.x - w / 2 + r, hold.y, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
}

function drawSloperShape(ctx, hold) {
  ctx.beginPath();
  ctx.ellipse(hold.x, hold.y, hold.size, hold.size * 0.85, 0, 0, Math.PI * 2);
  ctx.closePath();
}

// --- Climber rendering ---
const SKIN = "#d09a6e";
const SKIN_DARK = "#8b5e3a";
const SHIRT = "#d65a8a";
const SHORTS = "#1f3357";
const SHOE = "#2c8f4a";

function strokeChain(ctx, pts, width, color) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawClimber(ctx, c, dragLimb) {
  const p = c.parts;
  const head = headAnchor(p);

  // back layer: right limbs
  drawLimb(ctx, p.shR, p.elR, p.hR, "arm");
  drawLimb(ctx, p.hipR, p.knR, p.fR, "leg");

  // shorts (waistband)
  ctx.fillStyle = SHORTS;
  ctx.beginPath();
  ctx.moveTo(p.hipL.x - 4, p.hipL.y - 4);
  ctx.lineTo(p.hipR.x + 4, p.hipR.y - 4);
  ctx.lineTo(p.hipR.x + 6, p.hipR.y + 14);
  ctx.lineTo(p.hipL.x - 6, p.hipL.y + 14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // shirt
  ctx.fillStyle = SHIRT;
  ctx.beginPath();
  ctx.moveTo(p.shL.x - 2, p.shL.y - 2);
  ctx.lineTo(p.shR.x + 2, p.shR.y - 2);
  ctx.lineTo(p.hipR.x + 4, p.hipR.y - 2);
  ctx.lineTo(p.hipL.x - 4, p.hipL.y - 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // front layer: left limbs
  drawLimb(ctx, p.shL, p.elL, p.hL, "arm");
  drawLimb(ctx, p.hipL, p.knL, p.fL, "leg");

  // neck (small skin segment from chest → head)
  ctx.strokeStyle = SKIN;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(p.chest.x + head.upX * 8, p.chest.y + head.upY * 8);
  ctx.lineTo(head.x - head.upX * 12, head.y - head.upY * 12);
  ctx.stroke();

  // head — rigid skin circle that points toward `head.upX/upY`
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // hands
  drawHand(ctx, p.hL, HAND_TAPE.LH, !!c.grips.LH || dragLimb === "LH");
  drawHand(ctx, p.hR, HAND_TAPE.RH, !!c.grips.RH || dragLimb === "RH");

  // shoes
  drawShoe(ctx, p.knL, p.fL);
  drawShoe(ctx, p.knR, p.fR);
}

function drawLimb(ctx, a, b, c, kind) {
  strokeChain(ctx, [a, b, c], kind === "arm" ? 12 : 14, "rgba(0,0,0,0.4)");
  strokeChain(ctx, [a, b, c], kind === "arm" ? 9 : 11, SKIN);
  ctx.fillStyle = SKIN_DARK;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(b.x, b.y, kind === "arm" ? 4.5 : 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHand(ctx, p, tape, gripped) {
  ctx.save();
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = tape;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
  ctx.stroke();
  if (gripped) {
    ctx.strokeStyle = "rgba(245,158,11,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawGameBackdrop(ctx, w, h) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#211b16");
  bg.addColorStop(0.58, "#15110f");
  bg.addColorStop(1, "#0f0d0b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 18; y < h; y += 42) {
    ctx.fillRect(0, y, w, 1);
  }
}

function drawWallSurface(ctx, route, wallW, wallH) {
  ctx.fillStyle = route.wall?.color || "#e8d2ac";
  ctx.fillRect(0, 0, wallW, wallH);

  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fillRect(0, 0, wallW, wallH);

  for (let x = 0; x < wallW; x += 200) {
    ctx.fillStyle = x % 400 === 0 ? "rgba(118,78,39,0.06)" : "rgba(255,255,255,0.05)";
    ctx.fillRect(x, 0, 200, wallH);
    ctx.fillStyle = "rgba(0,0,0,0.055)";
    ctx.fillRect(x, 0, 1, wallH);
  }

  ctx.fillStyle = "rgba(255,255,255,0.14)";
  for (const hold of route.holds) {
    ctx.beginPath();
    ctx.ellipse(
      hold.x - hold.size * 0.18,
      hold.y - hold.size * 0.35,
      hold.size * 0.82,
      hold.size * 0.38,
      -0.2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.fillStyle = "rgba(74,49,29,0.16)";
  ctx.fillRect(0, 0, 10, wallH);
  ctx.fillRect(wallW - 10, 0, 10, wallH);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(0, wallH - 12, wallW, 12);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, wallH - 12, wallW, 2);
}

function drawStaminaHUD(ctx, climber, viewW) {
  const limbs = ["LH", "RH", "LF", "RF"];
  const barW = 118, barH = 8, gap = 7;
  const pad = 16;
  const totalW = barW + 48;
  const totalH = limbs.length * (barH + gap) + 18;
  ctx.save();
  ctx.translate(Math.max(pad, viewW - totalW - pad), 76);
  ctx.fillStyle = "rgba(18,16,14,0.76)";
  drawRoundRect(ctx, 0, 0, totalW, totalH, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = "bold 11px sans-serif";
  ctx.textBaseline = "middle";
  for (let i = 0; i < limbs.length; i++) {
    const limb = limbs[i];
    const v = Math.max(0, Math.min(1, climber.stamina[limb]));
    const y = 9 + i * (barH + gap) + barH / 2;
    ctx.fillStyle = STAMINA_LIMB_COLOR[limb];
    ctx.textAlign = "left";
    ctx.fillText(STAMINA_LIMB_LABEL[limb], 10, y);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    drawRoundRect(ctx, 40, y - barH / 2, barW, barH, 4);
    ctx.fill();
    ctx.fillStyle = v < 0.25 ? "#ef4444" : STAMINA_LIMB_COLOR[limb];
    drawRoundRect(ctx, 40, y - barH / 2, Math.max(3, barW * v), barH, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    drawRoundRect(ctx, 40, y - barH / 2, barW, barH, 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShoe(ctx, knee, foot) {
  const dx = foot.x - knee.x;
  const dy = foot.y - knee.y;
  const a = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(foot.x, foot.y);
  ctx.rotate(a);
  ctx.fillStyle = SHOE;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(2, 0, 11, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#10331e";
  ctx.beginPath();
  ctx.ellipse(2, 3, 10, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function fireWinConfetti() {
  const duration = 2200;
  const end = Date.now() + duration;
  const defaults = {
    colors: CONFETTI_COLORS,
    disableForReducedMotion: true,
    scalar: 1.35,
    spread: 95,
    startVelocity: 58,
    ticks: 260,
    zIndex: 100,
  };

  confetti({ ...defaults, particleCount: 260, origin: { x: 0.5, y: 0.42 }, spread: 130 });
  confetti({ ...defaults, particleCount: 180, angle: 60, origin: { x: 0, y: 0.78 } });
  confetti({ ...defaults, particleCount: 180, angle: 120, origin: { x: 1, y: 0.78 } });

  const interval = window.setInterval(() => {
    const remaining = end - Date.now();
    if (remaining <= 0) {
      window.clearInterval(interval);
      return;
    }
    const particleCount = Math.round(110 * (remaining / duration));
    confetti({
      ...defaults,
      particleCount,
      angle: randomInRange(55, 125),
      origin: { x: randomInRange(0.12, 0.88), y: randomInRange(0.1, 0.55) },
      spread: randomInRange(75, 130),
      startVelocity: randomInRange(42, 68),
    });
  }, 180);
}

// =============================================================================
// Initial pose: hands on start hold; auto-find feet on lower side holds.
// =============================================================================

function findFootStart(holds, startHold, side /* -1 left, +1 right */) {
  // Foot anchor (pelvis) sits roughly directly below the start hold once arms extend.
  const anchor = { x: startHold.x, y: startHold.y + ARM_LEN + L.spine * 0.4 };
  let best = null;
  let bestScore = Infinity;
  for (const h of holds) {
    if (h.id === startHold.id) continue;
    if (h.kind === "finish") continue;
    const kind = h.kind === "hold" ? "jug" : h.kind;
    if (kind === "crimp") continue; // feet can't grip crimps
    if (h.y < startHold.y + 30) continue; // must be below start
    const dx = h.x - anchor.x;
    const dy = h.y - anchor.y;
    const dist = Math.hypot(dx, dy);
    if (dist > FOOT_MAX_REACH - 8) continue;
    if (Math.sign(dx) !== side && Math.abs(dx) > 12) continue; // wrong side
    // Prefer holds on the correct side, lower (more natural footing)
    const score = dist + Math.abs(dx - side * 30) * 0.5;
    if (score < bestScore) { bestScore = score; best = h; }
  }
  return best;
}

function placeAtHold(part, hold, offsetX, offsetY = 0) {
  part.x = hold.x + offsetX;
  part.y = hold.y + offsetY;
  part.px = part.x; part.py = part.y;
}

function setupInitialPose(climber, route, now) {
  const start = route.holds.find((h) => h.kind === "start") || route.holds[0];
  const p = climber.parts;
  climber.stamina.LH = 1; climber.stamina.RH = 1;
  climber.stamina.LF = 1; climber.stamina.RF = 1;
  for (const limb of Object.keys(LIMB_HANDLES)) {
    climber.grips[limb] = null;
    climber.gripOffset[limb] = { x: 0, y: 0 };
    climber.gripStartedAt[limb] = 0;
  }

  // Place pelvis below the start hold so arms have room to extend
  const pelvisX = start.x;
  const pelvisY = start.y + ARM_LEN + L.spine * 0.7;

  Object.assign(p, makeClimber(pelvisX, pelvisY).parts);

  // Hands grip start hold (offset left/right; record offsets so per-frame
  // pinning won't snap the limbs back to a fixed point)
  placeAtHold(p.hL, start, -10, 0);
  placeAtHold(p.hR, start, 10, 0);
  climber.grips.LH = start.id;
  climber.grips.RH = start.id;
  climber.gripOffset.LH = { x: -10, y: 0 };
  climber.gripOffset.RH = { x: 10, y: 0 };
  climber.gripStartedAt.LH = now;
  climber.gripStartedAt.RH = now;

  // Try to grip feet on side holds below
  const footL = findFootStart(route.holds, start, -1);
  const footR = findFootStart(route.holds, start, +1);
  if (footL) {
    placeAtHold(p.fL, footL, -4, 0);
    climber.grips.LF = footL.id;
    climber.gripOffset.LF = { x: -4, y: 0 };
    climber.gripStartedAt.LF = now;
  }
  if (footR && footR !== footL) {
    placeAtHold(p.fR, footR, 4, 0);
    climber.grips.RF = footR.id;
    climber.gripOffset.RF = { x: 4, y: 0 };
    climber.gripStartedAt.RF = now;
  }

  // Pin grip points & solve for many iterations so the body settles into a
  // natural pose before we start rendering.
  for (const limb of Object.keys(LIMB_HANDLES)) {
    const id = climber.grips[limb];
    if (!id) continue;
    const part = p[LIMB_HANDLES[limb].end];
    part.pinned = true;
  }
  for (let i = 0; i < SETTLE_ITERS; i++) applyConstraints(climber);
  for (const limb of Object.keys(LIMB_HANDLES)) {
    const part = p[LIMB_HANDLES[limb].end];
    part.pinned = false;
  }
  // re-snap previous frame so verlet velocity = 0
  for (const k of ALL_PARTICLES) { p[k].px = p[k].x; p[k].py = p[k].y; }
}

// =============================================================================
// React component
// =============================================================================

export default function ClimberGame({ route, onWin }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const [status, setStatus] = useState("playing");
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const wallW = route.wall?.width ?? 800;
  const wallH = route.wall?.height ?? 1000;

  // Stable handle for re-init when route content changes
  const routeKey = useMemo(
    () => JSON.stringify({ id: route.id, n: route.holds.length }),
    [route],
  );

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const climber = makeClimber(wallW / 2, wallH / 2);
    setupInitialPose(climber, route, performance.now());

    const state = {
      route,
      climber,
      drag: null,
      view: { scale: 1, ox: 0, oy: 0, w: 0, h: 0 },
      moves: 0,
      startedAt: performance.now(),
      finishedElapsed: null,
      won: false,
      fallStart: null,
      resetQueued: false,
      // Latched flag: once a hand drag pushes past maxR we *commit* to
      // body-loading until the cursor is clearly back inside reach. Without
      // this, micro-jitter at the boundary toggles pinning/leg-drive every
      // frame and the body visibly convulses.
      bodyLoaded: false,
      // Time-smoothed leg drive. Snapping leg-drive each frame produced
      // visible chest jumps; we lerp toward the target over ~180 ms instead.
      legDrive: 0,
    };
    stateRef.current = state;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = Math.min(cw / wallW, ch / wallH);
      const ox = (cw - wallW * scale) / 2;
      const oy = (ch - wallH * scale) / 2;
      state.view = { scale, ox, oy, w: cw, h: ch };
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function worldFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { scale, ox, oy } = state.view;
      return { x: (sx - ox) / scale, y: (sy - oy) / scale };
    }

    function findHoldNear(x, y, padding = 8) {
      let best = null, bestD = Infinity;
      for (const h of state.route.holds) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= h.size + padding && d < bestD) { bestD = d; best = h; }
      }
      return best;
    }

    function findLimbNear(x, y) {
      let best = null, bestD = Infinity;
      for (const limb of Object.keys(LIMB_HANDLES)) {
        const part = state.climber.parts[LIMB_HANDLES[limb].end];
        const d = Math.hypot(part.x - x, part.y - y);
        if (d < 28 && d < bestD) { bestD = d; best = limb; }
      }
      return best;
    }

    function canGripWith(limb, hold) {
      const kind = hold.kind === "hold" ? "jug" : hold.kind;
      const rules = HOLD_KIND_RULES[kind];
      if (!rules) return false;
      if (LIMB_HANDLES[limb].kind === "foot" && !rules.feetCan) return false;
      if (state.climber.stamina[limb] <= 0.05) return false; // too tired
      return true;
    }

    function gripLimbToHold(limb, hold, dropX, dropY, now) {
      // Pin the limb at the player's actual drop position relative to the
      // hold center, clamped inside the hold footprint so it stays visually
      // on the hold. NO auto-snapping to hold center.
      let dx = dropX - hold.x;
      let dy = dropY - hold.y;
      const r = Math.max(4, hold.size * 0.7);
      const d = Math.hypot(dx, dy);
      if (d > r) { dx = (dx / d) * r; dy = (dy / d) * r; }
      state.climber.gripOffset[limb] = { x: dx, y: dy };
      const part = state.climber.parts[LIMB_HANDLES[limb].end];
      part.x = hold.x + dx;
      part.y = hold.y + dy;
      part.px = part.x; part.py = part.y;
      state.climber.grips[limb] = hold.id;
      state.climber.gripStartedAt[limb] = now;
    }

    function resetClimber() {
      setupInitialPose(state.climber, state.route, performance.now());
      state.drag = null;
      state.fallStart = null;
      state.finishedElapsed = null;
      state.resetQueued = false;
      state.bodyLoaded = false;
      state.legDrive = 0;
      setStatus("playing");
    }

    function releaseAllGrips() {
      for (const limb of Object.keys(LIMB_HANDLES)) {
        state.climber.grips[limb] = null;
        state.climber.parts[LIMB_HANDLES[limb].end].pinned = false;
      }
      state.drag = null;
      state.bodyLoaded = false;
    }

    function queueReset() {
      if (state.resetQueued) return;
      state.resetQueued = true;
      setTimeout(resetClimber, 350);
    }

    function onPointerDown(e) {
      if (state.won) return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      const w = worldFromEvent(e);
      const limb = findLimbNear(w.x, w.y);
      if (!limb) return;
      state.climber.grips[limb] = null;
      state.drag = { limb, x: w.x, y: w.y };
      state.bodyLoaded = false;
    }
    function onPointerMove(e) {
      if (!state.drag) return;
      const w = worldFromEvent(e);
      state.drag.x = w.x; state.drag.y = w.y;
    }
    function onPointerUp(e) {
      if (!state.drag) return;
      const w = worldFromEvent(e);
      const limb = state.drag.limb;
      const hold = findHoldNear(w.x, w.y, 16);
      const anchor = state.climber.parts[LIMB_HANDLES[limb].anchor];
      const maxR = LIMB_HANDLES[limb].maxReach;
      if (hold && canGripWith(limb, hold) &&
          Math.hypot(hold.x - anchor.x, hold.y - anchor.y) <= maxR) {
        gripLimbToHold(limb, hold, w.x, w.y, performance.now());
        state.moves += 1;
        setMoves(state.moves);
      }
      state.drag = null;
      state.bodyLoaded = false;
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    function onKey(e) {
      if (e.key === "r" || e.key === "R") resetClimber();
    }
    window.addEventListener("keydown", onKey);

    let raf = 0;
    let last = performance.now();
    function frame(now) {
      const dtMs = Math.min(40, now - last);
      const dt = dtMs / 1000;
      last = now;
      const c = state.climber;
      const parts = c.parts;
      const holdById = new Map(state.route.holds.map((h) => [h.id, h]));

      // 1a. Auto-release sloper grips after their slipMs
      for (const limb of Object.keys(LIMB_HANDLES)) {
        const id = c.grips[limb];
        if (!id) continue;
        const h = holdById.get(id);
        if (!h) continue;
        const kind = h.kind === "hold" ? "jug" : h.kind;
        const slip = HOLD_KIND_RULES[kind]?.slipMs || 0;
        if (slip > 0 && now - c.gripStartedAt[limb] > slip) {
          c.grips[limb] = null;
        }
      }
      // 1b. Stamina:
      //   drain rate = base(holdKind) × distribution(gripCount) × foot mult
      //   recover when limb is not gripping; auto-release at 0.
      let liveGripCount = 0;
      for (const limb of Object.keys(LIMB_HANDLES)) {
        if (c.grips[limb]) liveGripCount++;
      }
      const distMult = STAMINA_DIST_MULT[Math.min(4, Math.max(0, liveGripCount))] || 0;
      for (const limb of Object.keys(LIMB_HANDLES)) {
        const id = c.grips[limb];
        if (id) {
          const h = holdById.get(id);
          const kind = h && (h.kind === "hold" ? "jug" : h.kind);
          const base = STAMINA_DRAIN[kind] ?? 0.06;
          const isFoot = LIMB_HANDLES[limb].kind === "foot";
          const drain = base * distMult * (isFoot ? FOOT_DRAIN_MULT : 1);
          c.stamina[limb] -= drain * dt;
          if (c.stamina[limb] <= 0) {
            c.stamina[limb] = 0;
            c.grips[limb] = null;
          }
        } else {
          c.stamina[limb] = Math.min(1, c.stamina[limb] + STAMINA_RECOVERY * dt);
        }
      }

      // 2. Pin gripped limbs at the offset they were placed at
      //    (preserves where the player actually grabbed the hold)
      let gripCount = 0;
      for (const limb of Object.keys(LIMB_HANDLES)) {
        const id = c.grips[limb];
        const part = parts[LIMB_HANDLES[limb].end];
        if (id && holdById.has(id)) {
          const h = holdById.get(id);
          const off = c.gripOffset[limb] || { x: 0, y: 0 };
          part.pinned = true;
          part.x = h.x + off.x;
          part.y = h.y + off.y;
          gripCount++;
        } else {
          part.pinned = false;
        }
      }
      const footSupport = lowerBodySupport(c, holdById);

      // 3. Drag — the cursor sets a TARGET. A free hand moves quickly while
      //    it is only swinging from the shoulder. It enters the slow "try to
      //    reach" state only when the target needs the torso to move too.
      let dragOnHold = null;
      let dragOutOfReach = null;
      let dragTarget = null;
      let dragEffort = 0;          // 0 = relaxed, 1 = straining at max reach
      let targetLegDrive = footSupport.score > 0 ? 0.62 : 0;
      if (state.drag) {
        const limb = state.drag.limb;
        const handle = LIMB_HANDLES[limb];
        const part = parts[handle.end];
        const anchor = parts[handle.anchor];
        const maxR = handle.maxReach;
        const rawTargetDx = state.drag.x - anchor.x;
        const rawTargetDy = state.drag.y - anchor.y;
        const rawTargetDist = Math.hypot(rawTargetDx, rawTargetDy);
        const upwardReach = handle.kind === "hand"
          ? clamp01((anchor.y - state.drag.y - 8) / (maxR * 0.9))
          : 0;
        const reachOverflow = handle.kind === "hand"
          ? clamp01((rawTargetDist - maxR) / (maxR * 0.18))
          : 0;
        // Hysteresis on body-load. Engaging the moment the cursor crosses
        // maxR and disengaging the moment it slips back inside causes the
        // body to oscillate at the boundary (leg-drive shoves chest up →
        // distance drops → load releases → chest settles → distance grows
        // again → load re-engages). Latch instead: once engaged, stay
        // engaged until the cursor is comfortably inside the reach circle.
        if (handle.kind === "hand") {
          if (state.bodyLoaded) {
            if (rawTargetDist < maxR * 0.94) state.bodyLoaded = false;
          } else if (rawTargetDist > maxR) {
            state.bodyLoaded = true;
          }
        } else {
          state.bodyLoaded = false;
        }
        const needsBodyMove = handle.kind === "hand" && state.bodyLoaded;
        const hasLoadBearingFoot = footSupport.score >= MIN_LOAD_FOOT_SCORE;
        const canLoadBody = handle.kind === "foot" || (needsBodyMove && hasLoadBearingFoot);
        if (needsBodyMove && hasLoadBearingFoot) {
          targetLegDrive = Math.max(targetLegDrive, 0.62 + Math.max(upwardReach, reachOverflow) * 0.38);
        }

        // Target = cursor clamped to anchor's max reach
        let tdx = rawTargetDx;
        let tdy = rawTargetDy;
        const td = Math.hypot(tdx, tdy);
        if (td > maxR) { tdx = tdx * maxR / td; tdy = tdy * maxR / td; }
        const targetX = anchor.x + tdx;
        const targetY = anchor.y + tdy;
        dragTarget = { x: targetX, y: targetY };

        // EFFORT here means "trying to move the torso", not "the arm is long".
        // Free arm swings stay fast even near full extension.
        const bodyEffort = needsBodyMove && canLoadBody
          ? reachOverflow
          : 0;
        let effortFactor;
        if (bodyEffort <= EFFORT_FREE_RATIO) {
          effortFactor = 1.0;
        } else {
          const t = (bodyEffort - EFFORT_FREE_RATIO) / (1 - EFFORT_FREE_RATIO);
          effortFactor = Math.max(EFFORT_FLOOR, 1 - Math.pow(t, EFFORT_CURVE));
        }
        dragEffort = 1 - effortFactor;

        // Move limb toward target at effort-scaled finite speed
        const dx = targetX - part.x;
        const dy = targetY - part.y;
        const d = Math.hypot(dx, dy);
        const maxStep = DRAG_FOLLOW_SPEED * effortFactor * dt;
        if (d > maxStep) {
          part.x += dx * maxStep / d;
          part.y += dy * maxStep / d;
        } else {
          part.x = targetX;
          part.y = targetY;
        }
        // Pin only when the current stance can actually load torso movement.
        // A normal free-hand swing should not drag the body or slow down.
        part.pinned = canLoadBody;
        if (!part.pinned) {
          part.px = part.x;
          part.py = part.y;
        }

        const hovered = findHoldNear(state.drag.x, state.drag.y, 12);
        if (hovered) {
          const inReach = Math.hypot(hovered.x - anchor.x, hovered.y - anchor.y) <= maxR;
          if (inReach && canGripWith(state.drag.limb, hovered)) dragOnHold = hovered;
          else dragOutOfReach = hovered;
        }
      } else {
        state.bodyLoaded = false;
      }

      // Smooth leg-drive over a short window. Even with the bodyLoaded
      // hysteresis, the magnitude of the boost still depends on
      // upwardReach/reachOverflow which can change quickly; lerping the
      // applied strength prevents any residual frame-to-frame snap.
      const driveAlpha = 1 - Math.exp(-dt / 0.18);
      state.legDrive += (targetLegDrive - state.legDrive) * driveAlpha;
      const legDriveStrength = state.legDrive;

      // 4. Verlet step
      for (const k of ALL_PARTICLES) step(parts[k]);
      for (let i = 0; i < SOLVER_ITERS; i++) {
        applyConstraints(c);
        applyLegDriveConstraints(c, footSupport, legDriveStrength);
      }

      // 5. World bounds
      const floor = wallH;
      for (const k of ALL_PARTICLES) {
        const pp = parts[k];
        if (pp.pinned) continue;
        if (pp.x < 6) pp.x = 6;
        if (pp.x > wallW - 6) pp.x = wallW - 6;
        if (pp.y > floor - 4) { pp.y = floor - 4; pp.py = pp.y; }
      }

      // 6. Falling logic — only ACTUAL grips count. Both hands free is an
      //    immediate failure, even if the feet are still on holds. Otherwise,
      //    if fewer than two limbs are really gripping, after a brief grace
      //    period we cancel the drag entirely so the body really falls.
      if (!state.won) {
        const bothHandsFree = !c.grips.LH && !c.grips.RH;
        if (bothHandsFree) {
          releaseAllGrips();
          setStatus("falling");
          if (parts.pelvis.y > floor - 30) queueReset();
        } else if (gripCount < 2) {
          if (!state.fallStart) state.fallStart = now;
          if (now - state.fallStart > FALL_GRACE_MS) {
            // Force-release any drag — you can't hold yourself up by the cursor.
            if (state.drag) {
              const dl = state.drag.limb;
              parts[LIMB_HANDLES[dl].end].pinned = false;
              state.drag = null;
            }
            setStatus("falling");
            if (parts.pelvis.y > floor - 30) {
              queueReset();
              state.fallStart = null;
            }
          }
        } else {
          state.fallStart = null;
          state.resetQueued = false;
          setStatus("playing");
        }
      }

      // 7. Win check
      const lh = c.grips.LH ? holdById.get(c.grips.LH) : null;
      const rh = c.grips.RH ? holdById.get(c.grips.RH) : null;
      if (!state.won && lh && rh && lh.kind === "finish" && rh.kind === "finish") {
        state.won = true;
        state.finishedElapsed = ((now - state.startedAt) / 1000) | 0;
        setStatus("won");
        setElapsed(state.finishedElapsed);
        fireWinConfetti();
        if (typeof onWin === "function") {
          onWin({ moves: state.moves, elapsedMs: now - state.startedAt });
        }
      }

      if (!state.won) {
        setElapsed(((now - state.startedAt) / 1000) | 0);
      }

      // 8. Render
      const ctx = canvas.getContext("2d");
      const { scale, ox, oy, w, h } = state.view;
      drawGameBackdrop(ctx, w, h);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      drawWallSurface(ctx, state.route, wallW, wallH);

      // Reach circle when dragging — alpha grows with effort so the boundary
      // appears to "tighten" the harder you strain.
      if (state.drag) {
        const limb = state.drag.limb;
        const anchor = parts[LIMB_HANDLES[limb].anchor];
        const maxR = LIMB_HANDLES[limb].maxReach;
        const alpha = 0.32 + dragEffort * 0.5;
        ctx.strokeStyle = `rgba(245,158,11,${alpha.toFixed(3)})`;
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, maxR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Holds — including sloper countdown rings
      for (const hold of state.route.holds) {
        const kind = hold.kind === "hold" ? "jug" : hold.kind;
        let slipProgress = null;
        if (kind === "sloper") {
          for (const limb of Object.keys(LIMB_HANDLES)) {
            if (c.grips[limb] === hold.id) {
              const t = (now - c.gripStartedAt[limb]) / HOLD_KIND_RULES.sloper.slipMs;
              slipProgress = Math.min(1, Math.max(slipProgress ?? 0, t));
            }
          }
        }
        drawHold(ctx, hold, {
          highlight: dragOnHold && dragOnHold.id === hold.id,
          rejected: dragOutOfReach && dragOutOfReach.id === hold.id,
          slipProgress,
        });
      }

      drawClimber(ctx, c, state.drag ? state.drag.limb : null);

      // Drag indicator: tension line from limb to target. Color and thickness
      // shift from amber (relaxed) toward red (straining at full extension)
      // so the player can SEE the effort the climber is exerting.
      if (state.drag && dragTarget) {
        const part = parts[LIMB_HANDLES[state.drag.limb].end];
        const r = Math.round(220 + dragEffort * 35);
        const g = Math.round(160 - dragEffort * 130);
        const b = Math.round(40 - dragEffort * 20);
        const tensionColor = `rgb(${r},${Math.max(0, g)},${Math.max(0, b)})`;
        ctx.save();
        // tension line — gets thicker and dashed-tighter as you strain
        ctx.strokeStyle = tensionColor;
        ctx.lineWidth = 2 + dragEffort * 2;
        const dashOn = Math.max(2, 6 - dragEffort * 3);
        ctx.setLineDash([dashOn, Math.max(3, 8 - dragEffort * 4)]);
        ctx.beginPath();
        ctx.moveTo(part.x, part.y);
        ctx.lineTo(dragTarget.x, dragTarget.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // crosshair at target — outer ring pulses with effort
        ctx.strokeStyle = tensionColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(dragTarget.x, dragTarget.y, 7 + dragEffort * 3, 0, Math.PI * 2);
        ctx.moveTo(dragTarget.x - 11, dragTarget.y);
        ctx.lineTo(dragTarget.x + 11, dragTarget.y);
        ctx.moveTo(dragTarget.x, dragTarget.y - 11);
        ctx.lineTo(dragTarget.x, dragTarget.y + 11);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();

      // Stamina HUD (drawn in screen space, top-right)
      drawStaminaHUD(ctx, c, w);

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  function reset() {
    const s = stateRef.current;
    if (!s) return;
    setupInitialPose(s.climber, s.route, performance.now());
    s.drag = null; s.fallStart = null; s.resetQueued = false;
    s.finishedElapsed = null;
    s.won = false; s.moves = 0; s.startedAt = performance.now();
    setMoves(0); setElapsed(0); setStatus("playing");
  }

  async function toggleFullscreen() {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    } catch {
      setIsFullscreen(false);
    }
  }

  return (
    <div
      ref={stageRef}
      className="klifur-play-stage relative flex min-h-screen flex-1 overflow-hidden bg-[#15110e] text-stone-100"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none select-none"
      />

      <div className="klifur-stage-hud pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-stone-950/75 px-2.5 py-2 shadow-lg backdrop-blur">
          <Link
            href="/play"
            title="全部路线"
            aria-label="返回全部路线"
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-200 hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div className="min-w-0 border-l border-white/10 pl-3">
            <div className="truncate text-sm font-semibold text-white">{route.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-stone-300">
              <span>作者 · {route.author}</span>
              <span className="rounded bg-amber-400/16 px-1.5 py-0.5 text-amber-200">
                {route.difficulty}
              </span>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/10 bg-stone-950/75 px-2.5 py-2 text-xs text-stone-200 shadow-lg backdrop-blur">
          <span>步数 <strong className="font-semibold text-white">{moves}</strong></span>
          <span className="h-4 w-px bg-white/12" />
          <span>时间 <strong className="font-semibold text-white">{elapsed}s</strong></span>
          <button
            onClick={reset}
            title="重新开始本关 (R)"
            aria-label="重新开始本关"
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-200 hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 9 8 9" />
            </svg>
          </button>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "退出全屏" : "全屏"}
            aria-label={isFullscreen ? "退出全屏" : "全屏"}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-200 hover:bg-white/10 hover:text-white"
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v5H3" />
                <path d="M16 3v5h5" />
                <path d="M8 21v-5H3" />
                <path d="M16 21v-5h5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H3v5" />
                <path d="M16 3h5v5" />
                <path d="M8 21H3v-5" />
                <path d="M16 21h5v-5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {status === "won" && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
          <div className="pointer-events-auto rounded-lg border border-white/12 bg-stone-950/92 px-8 py-6 text-center text-stone-100 shadow-2xl">
            <h2 className="text-2xl font-bold text-emerald-300">登顶成功！</h2>
            <p className="mt-1 text-sm text-stone-300">用了 {moves} 步 · {elapsed} 秒</p>
            <button
              onClick={reset}
              className="mt-4 rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-medium text-stone-950 hover:bg-emerald-400"
            >
              再来一次
            </button>
          </div>
        </div>
      )}

      {status === "falling" && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-20 -translate-x-1/2 rounded-md bg-red-600/90 px-4 py-1.5 text-sm font-medium text-white shadow">
          掉下来了！
        </div>
      )}

      <div className="pointer-events-none absolute bottom-4 left-4 z-20 max-w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-white/10 bg-stone-950/72 px-3 py-2 text-xs leading-relaxed text-stone-200 shadow-lg backdrop-blur">
        <p>拖拽手脚到岩点；至少两个支点。想够高点时，让脚先踩在能承重的点上。</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-stone-300">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />起点</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />终点</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500" />大凸点</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-1 bg-stone-300" />小棱点</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border border-stone-300 bg-amber-200" />圆弧</span>
        </div>
      </div>
    </div>
  );
}
