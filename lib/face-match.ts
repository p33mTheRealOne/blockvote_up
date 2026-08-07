/**
 * Face verification utilities — browser-only port of the approach in
 * face.py (get embedding -> compare -> confidence tier), but using
 * @vladmandic/face-api (TensorFlow.js) instead of insightface/buffalo_l,
 * since that needs a Python backend with ONNX runtime.
 *
 * IMPORTANT — dynamic import only: @vladmandic/face-api pulls in
 * TensorFlow.js, which assumes a browser environment (it references
 * things like the native TextEncoder differently than Next.js's SSR/
 * server bundle does). A top-level `import * as faceapi from
 * "@vladmandic/face-api"` gets evaluated during Next.js's server-side
 * render pass too and crashes with "this.util.TextEncoder is not a
 * constructor". Every function below lazy-loads the module with
 * `await import(...)` instead, so it's only ever evaluated client-side,
 * on demand.
 *
 * IMPORTANT — threshold calibration: face-api.js's recognition model
 * is calibrated for Euclidean distance between descriptors (lower =
 * more similar), not cosine similarity like insightface's normed
 * embeddings. Reusing face.py's exact cosine-similarity thresholds
 * (0.60 / 0.50 / 0.42 / 0.35) against a *different* model's embedding
 * space would silently miscalibrate the matcher, which is dangerous
 * for something gating identity verification — so the tiers below use
 * distance instead, with commonly-cited face-api.js thresholds. Treat
 * these as a starting point: test with real photos and tune before
 * relying on this for anything with real consequences.
 */

type FaceApiModule = typeof import("@vladmandic/face-api");

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

let faceapiModulePromise: Promise<FaceApiModule> | null = null;

function getFaceApi(): Promise<FaceApiModule> {
  if (!faceapiModulePromise) {
    faceapiModulePromise = import("@vladmandic/face-api");
  }
  return faceapiModulePromise;
}

let modelsLoadedPromise: Promise<void> | null = null;

export function loadFaceModels(): Promise<void> {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = getFaceApi().then((faceapi) =>
      Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]).then(() => undefined)
    );
  }
  return modelsLoadedPromise;
}

export type FaceConfidence =
  | "VERY_HIGH"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "VERY_LOW";

export interface FaceMatchResult {
  verified: boolean;
  distance: number; // raw Euclidean distance, lower = more similar
  similarity: number; // 1 - distance, clamped to [0,1], for display only
  confidence: FaceConfidence;
}

// Distance tiers, roughly mirroring the shape of face.py's confidence
// bands. face-api.js's own docs cite ~0.6 as a typical match/no-match
// cutoff — these bands sit around that, tightest (most confident) first.
const DISTANCE_TIERS: Array<{
  maxDistance: number;
  confidence: FaceConfidence;
  verified: boolean;
}> = [
  { maxDistance: 0.4, confidence: "VERY_HIGH", verified: true },
  { maxDistance: 0.5, confidence: "HIGH", verified: true },
  { maxDistance: 0.6, confidence: "MEDIUM", verified: true },
  { maxDistance: 0.7, confidence: "LOW", verified: false },
  { maxDistance: Infinity, confidence: "VERY_LOW", verified: false },
];

export function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// TinyFaceDetector downsamples the whole image to `inputSize` before
// looking for faces. On the raw captured ID card, the actual face
// photo is a small region of a much larger image, so the default
// (416 / 0.5) often misses it entirely. Try progressively larger,
// more sensitive passes before giving up. Slower passes only run if
// the faster one already failed, so the common case (selfie, where
// the face fills most of the frame) stays fast.
const DETECTION_ATTEMPTS: Array<{ inputSize: number; scoreThreshold: number }> =
  [
    { inputSize: 416, scoreThreshold: 0.5 },
    { inputSize: 608, scoreThreshold: 0.3 },
    { inputSize: 800, scoreThreshold: 0.2 },
  ];

async function getFaceDescriptor(
  input: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
): Promise<Float32Array> {
  const faceapi = await getFaceApi();

  for (const options of DETECTION_ATTEMPTS) {
    const detection = await faceapi
      .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions(options))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (detection) {
      return detection.descriptor;
    }
  }

  throw new Error("ไม่พบใบหน้าในภาพ");
}

/**
 * Equivalent of face.py's verify_face(): takes the ID card photo and a
 * live selfie, returns whether they're the same person plus a
 * confidence tier. Both inputs can be data URLs (from canvas capture),
 * <img>, <canvas>, or <video> elements.
 */
export async function verifyFace(
  idCardInput: string | HTMLImageElement | HTMLCanvasElement,
  selfieInput: string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
): Promise<FaceMatchResult> {
  const faceapi = await getFaceApi();
  await loadFaceModels();

  const idImage =
    typeof idCardInput === "string"
      ? await dataUrlToImage(idCardInput)
      : idCardInput;
  const selfieImage =
    typeof selfieInput === "string"
      ? await dataUrlToImage(selfieInput)
      : selfieInput;

  const [idDescriptor, selfieDescriptor] = await Promise.all([
    getFaceDescriptor(idImage),
    getFaceDescriptor(selfieImage),
  ]);

  const distance = faceapi.euclideanDistance(idDescriptor, selfieDescriptor);
  const similarity = Math.max(0, 1 - distance);

  const tier = DISTANCE_TIERS.find((t) => distance <= t.maxDistance)!;

  return {
    verified: tier.verified,
    distance: Number(distance.toFixed(4)),
    similarity: Number(similarity.toFixed(4)),
    confidence: tier.confidence,
  };
}

/**
 * Lightweight "is a face currently visible" check, used to drive
 * auto-capture on the live selfie camera feed (no matching, just
 * presence — matching only happens once against the ID photo).
 */
export async function detectFacePresent(
  input: HTMLVideoElement
): Promise<boolean> {
  const faceapi = await getFaceApi();
  await loadFaceModels();
  const detection = await faceapi.detectSingleFace(
    input,
    new faceapi.TinyFaceDetectorOptions()
  );
  return !!detection;
}

/**
 * Returns the 68 raw landmark points for the current video frame, or
 * null if no face is detected. Used by the liveness challenge loop to
 * compute yaw/pitch/EAR metrics (see lib/liveness.ts).
 */
export async function detectLandmarks(
  input: HTMLVideoElement
): Promise<{ x: number; y: number }[] | null> {
  const faceapi = await getFaceApi();
  await loadFaceModels();

  const detection = await faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks();

  if (!detection) return null;

  return detection.landmarks.positions.map((p) => ({ x: p.x, y: p.y }));
}