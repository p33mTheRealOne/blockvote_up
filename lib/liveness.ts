import type * as FaceApi from "@vladmandic/face-api";

export type Challenge =
  | "LEFT"
  | "RIGHT"
  | "UP"
  | "DOWN"
  | "BLINK";

export type LivenessMetrics = {
  yaw: number;
  pitch: number;
  ear: number;
};

const YAW_THRESHOLD = 0.08;
const PITCH_THRESHOLD = 0.06;

const EAR_BLINK_THRESHOLD = 0.30;
const EAR_OPEN_THRESHOLD = 0.30;

const STRAIGHT_YAW_TOLERANCE = 0.05;
const STRAIGHT_PITCH_TOLERANCE = 0.05;

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return Math.sqrt(dx * dx + dy * dy);
}

export function computeMetrics(
  landmarks:
    | FaceApi.FaceLandmarks68
    | Array<{ x: number; y: number }>
): LivenessMetrics {
  const positions =
    "positions" in landmarks
      ? landmarks.positions
      : landmarks;

  if (positions.length < 48) {
    return {
      yaw: 0,
      pitch: 0,
      ear: 1,
    };
  }

  const nose = positions[30];

  const leftEyeOuter = positions[36];
  const leftEyeInner = positions[39];

  const rightEyeInner = positions[42];
  const rightEyeOuter = positions[45];

  const leftEyeTop = positions[37];
  const leftEyeBottom = positions[41];

  const rightEyeTop = positions[43];
  const rightEyeBottom = positions[47];

  const leftEyeWidth = distance(
    leftEyeOuter,
    leftEyeInner
  );

  const rightEyeWidth = distance(
    rightEyeInner,
    rightEyeOuter
  );

  const leftEyeHeight = distance(
    leftEyeTop,
    leftEyeBottom
  );

  const rightEyeHeight = distance(
    rightEyeTop,
    rightEyeBottom
  );

  const leftEar =
    leftEyeWidth > 0
      ? leftEyeHeight / leftEyeWidth
      : 0;

  const rightEar =
    rightEyeWidth > 0
      ? rightEyeHeight / rightEyeWidth
      : 0;

  const ear = (leftEar + rightEar) / 2;

  const eyeCenterX =
    (leftEyeOuter.x + rightEyeOuter.x) / 2;

  const faceWidth = distance(
    leftEyeOuter,
    rightEyeOuter
  );

  const yaw =
    faceWidth > 0
      ? (nose.x - eyeCenterX) / faceWidth
      : 0;

  const eyeCenterY =
    (leftEyeOuter.y + rightEyeOuter.y) / 2;

  const noseToEyeDistance =
    Math.abs(nose.y - eyeCenterY);

  const pitch =
    faceWidth > 0
      ? noseToEyeDistance / faceWidth - 0.35
      : 0;

  return {
    yaw,
    pitch,
    ear,
  };
}

export function mirrorPositions(
  positions: Array<{ x: number; y: number }>,
  width: number
): Array<{ x: number; y: number }> {
  return positions.map((point) => ({
    x: width - point.x,
    y: point.y,
  }));
}

export function shuffleChallenges(): Challenge[] {
  const challenges: Challenge[] = [
    "LEFT",
    "RIGHT",
    "UP",
    "DOWN",
    "BLINK",
  ];

  for (let i = challenges.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [challenges[i], challenges[j]] = [
      challenges[j],
      challenges[i],
    ];
  }

  return challenges;
}

export function averageBrightness(
  source:
    | HTMLVideoElement
    | HTMLCanvasElement
    | ImageData
    | ImageDataArray
): number {
  let data: Uint8ClampedArray | ImageDataArray;

  if (source instanceof ImageData) {
    data = source.data;
  } else if (
    typeof HTMLVideoElement !== "undefined" &&
    source instanceof HTMLVideoElement
  ) {
    const canvas = document.createElement("canvas");

    const width = source.videoWidth;
    const height = source.videoHeight;

    if (!width || !height) {
      return 0;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return 0;
    }

    ctx.drawImage(
      source,
      0,
      0,
      width,
      height
    );

    data = ctx.getImageData(
      0,
      0,
      width,
      height
    ).data;
  } else if (
    typeof HTMLCanvasElement !== "undefined" &&
    source instanceof HTMLCanvasElement
  ) {
    const ctx = source.getContext("2d");

    if (!ctx) {
      return 0;
    }

    data = ctx.getImageData(
      0,
      0,
      source.width,
      source.height
    ).data;
  } else {
    data = source as ImageDataArray;
  }

  let total = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;

    total +=
      0.299 * r +
      0.587 * g +
      0.114 * b;

    count++;
  }

  return count > 0 ? total / count : 0;
}

export function isTurnLeft(
  metrics: LivenessMetrics
): boolean {
  return metrics.yaw < -YAW_THRESHOLD;
}

export function isTurnRight(
  metrics: LivenessMetrics
): boolean {
  return metrics.yaw > YAW_THRESHOLD;
}

export function isLookUp(
  metrics: LivenessMetrics
): boolean {
  return metrics.pitch < -PITCH_THRESHOLD;
}

export function isLookDown(
  metrics: LivenessMetrics
): boolean {
  return metrics.pitch > PITCH_THRESHOLD;
}

export function isBlink(
  metrics: LivenessMetrics
): boolean {
  return metrics.ear < EAR_BLINK_THRESHOLD;
}

export function eyesAreOpen(
  metrics: LivenessMetrics
): boolean {
  return metrics.ear >= EAR_OPEN_THRESHOLD;
}

export function isLookingStraight(
  metrics: LivenessMetrics
): boolean {
  return (
    Math.abs(metrics.yaw) <=
      STRAIGHT_YAW_TOLERANCE &&
    Math.abs(metrics.pitch) <=
      STRAIGHT_PITCH_TOLERANCE
  );
}