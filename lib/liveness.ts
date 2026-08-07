/**
 * Liveness-check math: pure functions that turn 68-point face
 * landmarks into simple yaw / pitch / eye-openness metrics, used to
 * detect head turns, nods, and blinks during the challenge sequence.
 *
 * This is a UX-level anti-spoofing deterrent (stops someone from just
 * holding up a photo or playing a static image), NOT cryptographic-
 * grade liveness detection. A sufficiently good video replay that
 * performs the same motions could still pass — there's no depth
 * sensor or hardware attestation involved, just 2D landmark geometry
 * in the browser. Treat it as raising the bar, not a guarantee.
 *
 * Landmark index ranges follow the standard 68-point (dlib / iBUG
 * 300-W) convention, which @vladmandic/face-api's model also uses:
 *   jaw: 0-16   right eyebrow: 17-21   left eyebrow: 22-26
 *   nose bridge: 27-30   nose bottom: 31-35
 *   right eye: 36-41   left eye: 42-47   mouth: 48-67
 */

export interface Point {
  x: number;
  y: number;
}

export interface LandmarkMetrics {
  yaw: number; // horizontal nose position relative to eyes, ~0.5 = centered
  pitch: number; // vertical nose position relative to eyes/mouth, heuristic
  ear: number; // eye aspect ratio; lower = more closed (blink)
}

function avg(points: Point[]): Point {
  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const y = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x, y };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Standard 6-point EAR: (‖p1-p5‖ + ‖p2-p4‖) / (2 * ‖p0-p3‖)
function eyeAspectRatio(eye: Point[]): number {
  const vertical1 = dist(eye[1], eye[5]);
  const vertical2 = dist(eye[2], eye[4]);
  const horizontal = dist(eye[0], eye[3]);
  if (horizontal === 0) return 0;
  return (vertical1 + vertical2) / (2 * horizontal);
}

/**
 * Mirrors landmark x-coordinates so "left"/"right" in the resulting
 * metrics match what the user sees in a mirrored (CSS -scale-x-100)
 * camera preview, instead of the raw unmirrored camera frame — so
 * on-screen "turn left" instructions correspond to the direction the
 * user actually perceives in their own mirror-like preview.
 */
export function mirrorPositions(
  positions: Point[],
  frameWidth: number
): Point[] {
  return positions.map((p) => ({ x: frameWidth - p.x, y: p.y }));
}

export function computeMetrics(positions: Point[]): LandmarkMetrics {
  const rightEye = positions.slice(36, 42);
  const leftEye = positions.slice(42, 48);
  const noseTip = positions[30];
  const noseBottom = positions[33];
  const mouth = positions.slice(48, 68);

  const leftEyeCenter = avg(leftEye);
  const rightEyeCenter = avg(rightEye);
  const mouthCenter = avg(mouth);

  const eyeSpan = rightEyeCenter.x - leftEyeCenter.x || 1;
  const yaw = (noseTip.x - leftEyeCenter.x) / eyeSpan;

  const eyeLineY = (leftEyeCenter.y + rightEyeCenter.y) / 2;
  const faceSpan = mouthCenter.y - eyeLineY || 1;
  const pitch = (noseBottom.y - eyeLineY) / faceSpan;

  const ear = (eyeAspectRatio(rightEye) + eyeAspectRatio(leftEye)) / 2;

  return { yaw, pitch, ear };
}

export type LivenessChallenge =
  | "turn-left"
  | "turn-right"
  | "nod-up"
  | "nod-down"
  | "blink";

export const CHALLENGE_LABELS: Record<LivenessChallenge, string> = {
  "turn-left": "หันหน้าไปทางซ้าย",
  "turn-right": "หันหน้าไปทางขวา",
  "nod-up": "เงยหน้าขึ้นเล็กน้อย",
  "nod-down": "ก้มหน้าลงเล็กน้อย",
  blink: "กระพริบตา 1 ครั้ง",
};

// Thresholds are deltas from a per-session calibrated baseline (each
// face/camera has different neutral yaw/pitch), not absolute values.
export const YAW_THRESHOLD = 0.13;
export const PITCH_THRESHOLD = 0.09;

// Eased so a lighter/faster blink still registers: EAR for a fully
// open eye is typically ~0.30-0.35, fully closed ~0.05-0.15. Triggering
// "closed" as soon as EAR dips under 0.26 (rather than 0.22) catches
// partial/quick blinks that don't fully close the eye.
export const EAR_BLINK_THRESHOLD = 0.3;
export const EAR_OPEN_THRESHOLD = 0.3;

// How close yaw/pitch must be back to baseline before the final
// "look straight ahead" capture is allowed to fire.
export const STRAIGHT_YAW_TOLERANCE = 0.08;
export const STRAIGHT_PITCH_TOLERANCE = 0.07;

// Average frame luminance (0-255) must fall in this range, or the
// scan is considered too dark / too bright to trust.
export const BRIGHTNESS_MIN = 60;
export const BRIGHTNESS_MAX = 205;

export function averageBrightness(imageData: ImageData): number {
  const data = imageData.data;
  let total = 0;
  const pixelCount = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    total += 0.299 * r + 0.587 * g + 0.114 * b;
  }

  return pixelCount === 0 ? 0 : total / pixelCount;
}

/**
 * Returns a random order for the turn/nod/blink challenges (blink
 * always checked continuously rather than sequenced, see caller) —
 * randomizing order makes a pre-recorded loop less likely to line up
 * with whatever the UI happens to ask for.
 */
export function shuffleChallenges(
  challenges: LivenessChallenge[]
): LivenessChallenge[] {
  const arr = [...challenges];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}