import type { Keypoint } from "@tensorflow-models/pose-detection";

export type ExerciseId =
  | "squat"
  | "jump"
  | "pushup"
  | "lunge"
  | "bicep_curl"
  | "shoulder_press"
  | "lateral_raise"
  | "front_raise"
  | "situp"
  | "jumping_jack";

export interface ExerciseMeta {
  id: ExerciseId;
  label: string;
  emoji: string;
  hint: string;
  /** Base points per rep */
  basePoints: number;
}

export const EXERCISES: ExerciseMeta[] = [
  { id: "squat", label: "Squats", emoji: "🦵", hint: "Stand sideways or facing camera, bend knees", basePoints: 10 },
  { id: "jump", label: "Jumps", emoji: "🦘", hint: "Jump straight up", basePoints: 12 },
  { id: "pushup", label: "Push-ups", emoji: "🤸", hint: "Side-on view, lower chest to ground", basePoints: 14 },
  { id: "lunge", label: "Lunges", emoji: "🚶", hint: "Step forward and bend front knee", basePoints: 12 },
  { id: "bicep_curl", label: "Bicep Curls", emoji: "💪", hint: "Curl wrists toward shoulders", basePoints: 8 },
  { id: "shoulder_press", label: "Shoulder Press", emoji: "🏋️", hint: "Press hands overhead from shoulders", basePoints: 10 },
  { id: "lateral_raise", label: "Lateral Raises", emoji: "🕴️", hint: "Raise arms out to sides", basePoints: 8 },
  { id: "front_raise", label: "Front Raises", emoji: "🙆", hint: "Raise arms forward to shoulder height", basePoints: 8 },
  { id: "situp", label: "Sit-ups", emoji: "🧘", hint: "Lie down, raise torso toward knees", basePoints: 10 },
  { id: "jumping_jack", label: "Jumping Jacks", emoji: "⭐", hint: "Arms up, legs out", basePoints: 8 },
];

type KP = Keypoint | undefined;

const MIN_SCORE = 0.35;
const ok = (k: KP) => !!k && (k.score ?? 0) >= MIN_SCORE;

/** Angle in degrees at vertex b given points a-b-c. */
function angle(a: KP, b: KP, c: KP): number | null {
  if (!ok(a) || !ok(b) || !ok(c)) return null;
  const v1x = a!.x - b!.x;
  const v1y = a!.y - b!.y;
  const v2x = c!.x - b!.x;
  const v2y = c!.y - b!.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return null;
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function avg(...nums: (number | null)[]): number | null {
  const v = nums.filter((n): n is number => n !== null);
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Per-exercise mutable state */
export interface DetectorState {
  phase: "up" | "down" | "in" | "out";
  lastRepTime: number;
  baseline: Record<string, number | null>;
}

export function makeState(): DetectorState {
  return { phase: "up", lastRepTime: 0, baseline: {} };
}

export interface DetectorContext {
  get: (name: string) => KP;
  now: number;
  state: DetectorState;
}

/** Each detector returns true when a rep just completed. */
export type Detector = (ctx: DetectorContext) => boolean;

const COOLDOWN = 500;

/** Helper: state machine on a metric crossing thresholds (down then up). */
function repOnCycle(
  ctx: DetectorContext,
  metric: number | null,
  downBelow: number,
  upAbove: number,
): boolean {
  if (metric === null) return false;
  const s = ctx.state;
  if (s.phase === "up" && metric < downBelow) {
    s.phase = "down";
  } else if (s.phase === "down" && metric > upAbove) {
    if (ctx.now - s.lastRepTime > COOLDOWN) {
      s.lastRepTime = ctx.now;
      s.phase = "up";
      return true;
    }
    s.phase = "up";
  }
  return false;
}

const detectors: Record<ExerciseId, Detector> = {
  squat: (ctx) => {
    const a = avg(
      angle(ctx.get("left_hip"), ctx.get("left_knee"), ctx.get("left_ankle")),
      angle(ctx.get("right_hip"), ctx.get("right_knee"), ctx.get("right_ankle")),
    );
    return repOnCycle(ctx, a, 110, 160);
  },

  jump: (ctx) => {
    const lh = ctx.get("left_hip");
    const rh = ctx.get("right_hip");
    if (!ok(lh) || !ok(rh)) return false;
    const hipY = (lh!.y + rh!.y) / 2;
    const s = ctx.state;
    if (s.baseline.hipY === undefined || s.baseline.hipY === null) s.baseline.hipY = hipY;
    if (s.phase === "up") s.baseline.hipY = s.baseline.hipY * 0.95 + hipY * 0.05;
    const rise = (s.baseline.hipY ?? hipY) - hipY;
    if (s.phase === "up" && rise > 40) s.phase = "down";
    else if (s.phase === "down" && rise < 8) {
      if (ctx.now - s.lastRepTime > COOLDOWN) {
        s.lastRepTime = ctx.now;
        s.phase = "up";
        return true;
      }
      s.phase = "up";
    }
    return false;
  },

  pushup: (ctx) => {
    const a = avg(
      angle(ctx.get("left_shoulder"), ctx.get("left_elbow"), ctx.get("left_wrist")),
      angle(ctx.get("right_shoulder"), ctx.get("right_elbow"), ctx.get("right_wrist")),
    );
    // Require torso roughly horizontal: shoulder-hip y close
    const ls = ctx.get("left_shoulder");
    const lh = ctx.get("left_hip");
    if (ok(ls) && ok(lh)) {
      const dy = Math.abs(ls!.y - lh!.y);
      const dx = Math.abs(ls!.x - lh!.x);
      if (dx < dy * 1.2) return false; // not horizontal enough
    }
    return repOnCycle(ctx, a, 95, 155);
  },

  lunge: (ctx) => {
    // Lunge: one knee bends ~90deg while the other stays straighter, hips lower
    const la = angle(ctx.get("left_hip"), ctx.get("left_knee"), ctx.get("left_ankle"));
    const ra = angle(ctx.get("right_hip"), ctx.get("right_knee"), ctx.get("right_ankle"));
    if (la === null || ra === null) return false;
    const minA = Math.min(la, ra);
    const maxA = Math.max(la, ra);
    // metric: small when in lunge (one bent), large when standing (both straight)
    const metric = minA + (maxA - minA) * 0.3;
    return repOnCycle(ctx, metric, 110, 160);
  },

  bicep_curl: (ctx) => {
    const a = avg(
      angle(ctx.get("left_shoulder"), ctx.get("left_elbow"), ctx.get("left_wrist")),
      angle(ctx.get("right_shoulder"), ctx.get("right_elbow"), ctx.get("right_wrist")),
    );
    // Standing check: shoulders above hips
    const ls = ctx.get("left_shoulder");
    const lh = ctx.get("left_hip");
    if (ok(ls) && ok(lh) && ls!.y > lh!.y - 20) return false;
    return repOnCycle(ctx, a, 60, 150);
  },

  shoulder_press: (ctx) => {
    // Wrist goes from near shoulder height up above head, elbow extends
    const lw = ctx.get("left_wrist");
    const rw = ctx.get("right_wrist");
    const ls = ctx.get("left_shoulder");
    const rs = ctx.get("right_shoulder");
    const nose = ctx.get("nose");
    if (!ok(lw) || !ok(rw) || !ok(ls) || !ok(rs) || !ok(nose)) return false;
    const wristY = (lw!.y + rw!.y) / 2;
    const shoulderY = (ls!.y + rs!.y) / 2;
    // metric: positive when wrists below head, negative when above
    const metric = wristY - nose!.y;
    const s = ctx.state;
    if (s.phase === "up" && metric < -20) s.phase = "down"; // pressed up
    else if (s.phase === "down" && wristY > shoulderY - 10) {
      if (ctx.now - s.lastRepTime > COOLDOWN) {
        s.lastRepTime = ctx.now;
        s.phase = "up";
        return true;
      }
      s.phase = "up";
    }
    return false;
  },

  lateral_raise: (ctx) => {
    // Wrists move from beside hips out to shoulder level, arms roughly horizontal
    const lw = ctx.get("left_wrist");
    const rw = ctx.get("right_wrist");
    const ls = ctx.get("left_shoulder");
    const rs = ctx.get("right_shoulder");
    if (!ok(lw) || !ok(rw) || !ok(ls) || !ok(rs)) return false;
    const shoulderY = (ls!.y + rs!.y) / 2;
    const wristY = (lw!.y + rw!.y) / 2;
    const shoulderW = Math.abs(ls!.x - rs!.x) || 1;
    const wristSpread = Math.abs(lw!.x - rw!.x) / shoulderW;
    // metric: low at top of rep (wrists at shoulder height + spread wide)
    const heightDelta = wristY - shoulderY; // ~0 when raised
    if (wristSpread < 1.4) {
      // arms not spread => can't be at top
      const s = ctx.state;
      if (s.phase === "down" && heightDelta > 60) {
        if (ctx.now - s.lastRepTime > COOLDOWN) {
          s.lastRepTime = ctx.now;
          s.phase = "up";
          return true;
        }
        s.phase = "up";
      }
      return false;
    }
    const s = ctx.state;
    if (s.phase === "up" && Math.abs(heightDelta) < 30 && wristSpread > 1.6) s.phase = "down";
    else if (s.phase === "down" && heightDelta > 60) {
      if (ctx.now - s.lastRepTime > COOLDOWN) {
        s.lastRepTime = ctx.now;
        s.phase = "up";
        return true;
      }
      s.phase = "up";
    }
    return false;
  },

  front_raise: (ctx) => {
    // Arms raise forward: wrists rise to shoulder height but stay narrow (close to shoulder width)
    const lw = ctx.get("left_wrist");
    const rw = ctx.get("right_wrist");
    const ls = ctx.get("left_shoulder");
    const rs = ctx.get("right_shoulder");
    if (!ok(lw) || !ok(rw) || !ok(ls) || !ok(rs)) return false;
    const shoulderY = (ls!.y + rs!.y) / 2;
    const wristY = (lw!.y + rw!.y) / 2;
    const shoulderW = Math.abs(ls!.x - rs!.x) || 1;
    const wristSpread = Math.abs(lw!.x - rw!.x) / shoulderW;
    const heightDelta = wristY - shoulderY;
    const s = ctx.state;
    if (s.phase === "up" && Math.abs(heightDelta) < 30 && wristSpread < 1.5) s.phase = "down";
    else if (s.phase === "down" && heightDelta > 60) {
      if (ctx.now - s.lastRepTime > COOLDOWN) {
        s.lastRepTime = ctx.now;
        s.phase = "up";
        return true;
      }
      s.phase = "up";
    }
    return false;
  },

  situp: (ctx) => {
    // Lying: shoulders and hips have similar y. Sit-up: shoulders rise (y decreases) toward knees.
    const ls = ctx.get("left_shoulder");
    const rs = ctx.get("right_shoulder");
    const lh = ctx.get("left_hip");
    const rh = ctx.get("right_hip");
    const lk = ctx.get("left_knee");
    const rk = ctx.get("right_knee");
    if (!ok(ls) || !ok(rs) || !ok(lh) || !ok(rh) || !ok(lk) || !ok(rk)) return false;
    const shoulderY = (ls!.y + rs!.y) / 2;
    const hipY = (lh!.y + rh!.y) / 2;
    const kneeY = (lk!.y + rk!.y) / 2;
    // Require legs bent (knee above hip in lying view => knee y < hip y is unreliable).
    // Use ratio: how much shoulder is above hip vs hip-to-knee distance
    const refDist = Math.abs(hipY - kneeY) || 1;
    const rise = (hipY - shoulderY) / refDist; // ~0 lying, large when sitting up
    return repOnCycle(ctx, -rise, -1.2, -0.2);
  },

  jumping_jack: (ctx) => {
    const lw = ctx.get("left_wrist");
    const rw = ctx.get("right_wrist");
    const la = ctx.get("left_ankle");
    const ra = ctx.get("right_ankle");
    const ls = ctx.get("left_shoulder");
    const rs = ctx.get("right_shoulder");
    const nose = ctx.get("nose");
    if (!ok(lw) || !ok(rw) || !ok(la) || !ok(ra) || !ok(ls) || !ok(rs) || !ok(nose)) return false;
    const shoulderW = Math.abs(ls!.x - rs!.x) || 1;
    const ankleSpread = Math.abs(la!.x - ra!.x) / shoulderW;
    const wristsAbove = (lw!.y < nose!.y ? 1 : 0) + (rw!.y < nose!.y ? 1 : 0);
    // open: ankles wide AND both wrists above head
    const open = ankleSpread > 1.3 && wristsAbove === 2;
    const closed = ankleSpread < 0.9 && lw!.y > ls!.y && rw!.y > rs!.y;
    const s = ctx.state;
    if (s.phase === "up" && open) s.phase = "down";
    else if (s.phase === "down" && closed) {
      if (ctx.now - s.lastRepTime > COOLDOWN) {
        s.lastRepTime = ctx.now;
        s.phase = "up";
        return true;
      }
      s.phase = "up";
    }
    return false;
  },
};

export function getDetector(id: ExerciseId): Detector {
  return detectors[id];
}

export function allExerciseIds(): ExerciseId[] {
  return EXERCISES.map((e) => e.id);
}