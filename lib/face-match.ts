let faceapi:
  | typeof import("@vladmandic/face-api")
  | null = null;

let modelsLoaded = false;

const MODEL_URL =
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

/* =========================================================
   FACE API
========================================================= */

async function getFaceApi() {
  if (typeof window === "undefined") {
    throw new Error("Face API can only run in the browser");
  }

  if (!faceapi) {
    faceapi = await import("@vladmandic/face-api");
  }

  return faceapi;
}

/* =========================================================
   LOAD MODELS
========================================================= */

export async function loadFaceModels(): Promise<void> {
  const api = await getFaceApi();

  if (modelsLoaded) {
    return;
  }

  await Promise.all([
    api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);

  modelsLoaded = true;
}

/* =========================================================
   LANDMARK DETECTION
========================================================= */

export async function detectLandmarks(
  video: HTMLVideoElement
) {
  const api = await getFaceApi();

  await loadFaceModels();

  const detection = await api
    .detectSingleFace(
      video,
      new api.TinyFaceDetectorOptions({
        inputSize: 320,
        scoreThreshold: 0.5,
      })
    )
    .withFaceLandmarks();

  if (!detection) {
    return null;
  }

  return detection.landmarks;
}

/* =========================================================
   TYPES
========================================================= */

export type FaceVerificationResult = {
  matched: boolean;
  verified: boolean;
  similarity: number;
  confidence:
    | "VERY_HIGH"
    | "HIGH"
    | "MEDIUM"
    | "LOW"
    | "VERY_LOW";
  distance: number;
};

/* =========================================================
   CONFIDENCE
========================================================= */

function confidenceFromDistance(
  distance: number
): FaceVerificationResult["confidence"] {
  if (distance < 0.4) {
    return "VERY_HIGH";
  }

  if (distance < 0.5) {
    return "HIGH";
  }

  if (distance < 0.6) {
    return "MEDIUM";
  }

  if (distance < 0.7) {
    return "LOW";
  }

  return "VERY_LOW";
}

/* =========================================================
   UPSCALE IMAGE
========================================================= */

function createUpscaledImage(
  source: HTMLImageElement,
  scale = 3
): HTMLCanvasElement {
  const width =
    source.naturalWidth || source.width;

  const height =
    source.naturalHeight || source.height;

  if (!width || !height) {
    throw new Error(
      "รูปบัตรประชาชนไม่มีขนาดที่ถูกต้อง"
    );
  }

  const canvas =
    document.createElement("canvas");

  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const context =
    canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "ไม่สามารถสร้าง Canvas สำหรับตรวจสอบใบหน้าได้"
    );
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.drawImage(
    source,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas;
}

/* =========================================================
   CROP RIGHT-SIDE ID PHOTO
========================================================= */

function cropIdPhotoRegion(
  source: HTMLImageElement
): HTMLCanvasElement {
  const width =
    source.naturalWidth || source.width;

  const height =
    source.naturalHeight || source.height;

  if (!width || !height) {
    throw new Error(
      "รูปบัตรประชาชนไม่มีขนาดที่ถูกต้อง"
    );
  }

  /*
   * รูปประชาชนอยู่ด้านขวาของบัตร
   *
   * เราเผื่อพื้นที่รอบรูปเอาไว้
   * เพื่อป้องกันการ crop ใบหน้าออก
   */

  const cropX = Math.floor(width * 0.52);
  const cropY = Math.floor(height * 0.03);

  const cropWidth = Math.floor(
    width * 0.46
  );

  const cropHeight = Math.floor(
    height * 0.94
  );

  const scale = 3;

  const canvas =
    document.createElement("canvas");

  canvas.width =
    Math.max(1, cropWidth * scale);

  canvas.height =
    Math.max(1, cropHeight * scale);

  const context =
    canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "ไม่สามารถสร้าง Canvas สำหรับ crop รูปบัตรได้"
    );
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.drawImage(
    source,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas;
}

/* =========================================================
   CROP RIGHT-SIDE WITH DIFFERENT AREAS
========================================================= */

function cropIdPhotoRegionWide(
  source: HTMLImageElement
): HTMLCanvasElement {
  const width =
    source.naturalWidth || source.width;

  const height =
    source.naturalHeight || source.height;

  const cropX = Math.floor(width * 0.45);
  const cropY = 0;

  const cropWidth = Math.floor(
    width * 0.55
  );

  const cropHeight = height;

  const scale = 3;

  const canvas =
    document.createElement("canvas");

  canvas.width =
    Math.max(1, cropWidth * scale);

  canvas.height =
    Math.max(1, cropHeight * scale);

  const context =
    canvas.getContext("2d");

  if (!context) {
    throw new Error(
      "ไม่สามารถสร้าง Canvas สำหรับ crop รูปบัตรได้"
    );
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.drawImage(
    source,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas;
}

/* =========================================================
   DETECT FACE
========================================================= */

async function detectFace(
  source:
    | HTMLImageElement
    | HTMLCanvasElement
    | HTMLVideoElement,
  inputSize: 320 | 416 | 512,
  scoreThreshold: number
) {
  const api = await getFaceApi();

  const options =
    new api.TinyFaceDetectorOptions({
      inputSize,
      scoreThreshold,
    });

  return api
    .detectSingleFace(
      source,
      options
    )
    .withFaceLandmarks()
    .withFaceDescriptor();
}

/* =========================================================
   DETECT ID FACE WITH FALLBACKS
========================================================= */

async function detectIdFace(
  source: HTMLImageElement
) {
  /*
   * Attempt 1
   * ตรวจภาพบัตรเต็มภาพ
   */
  try {
    const result = await detectFace(
      source,
      416,
      0.2
    );

    if (result) {
      console.log(
        "[Face Match] ID face detected: full image"
      );

      return result;
    }
  } catch (error) {
    console.warn(
      "[Face Match] Full image detection failed",
      error
    );
  }

  /*
   * Attempt 2
   * Upscale ภาพบัตรทั้งใบ
   */
  try {
    const upscaled =
      createUpscaledImage(source, 3);

    const result = await detectFace(
      upscaled,
      512,
      0.15
    );

    if (result) {
      console.log(
        "[Face Match] ID face detected: upscaled"
      );

      return result;
    }
  } catch (error) {
    console.warn(
      "[Face Match] Upscaled detection failed",
      error
    );
  }

  /*
   * Attempt 3
   * Crop ฝั่งขวา ซึ่งเป็นบริเวณรูปบนบัตร
   */
  try {
    const cropped =
      cropIdPhotoRegion(source);

    const result = await detectFace(
      cropped,
      512,
      0.15
    );

    if (result) {
      console.log(
        "[Face Match] ID face detected: right crop"
      );

      return result;
    }
  } catch (error) {
    console.warn(
      "[Face Match] Right crop detection failed",
      error
    );
  }

  /*
   * Attempt 4
   * Crop ฝั่งขวาแบบกว้างกว่าเดิม
   */
  try {
    const croppedWide =
      cropIdPhotoRegionWide(source);

    const result = await detectFace(
      croppedWide,
      512,
      0.1
    );

    if (result) {
      console.log(
        "[Face Match] ID face detected: wide right crop"
      );

      return result;
    }
  } catch (error) {
    console.warn(
      "[Face Match] Wide crop detection failed",
      error
    );
  }

  return null;
}

/* =========================================================
   VERIFY FACE
========================================================= */

export async function verifyFace(
  idImage:
    | HTMLImageElement
    | HTMLCanvasElement
    | HTMLVideoElement,
  selfieImage:
    | HTMLImageElement
    | HTMLCanvasElement
    | HTMLVideoElement
): Promise<FaceVerificationResult> {
  const api = await getFaceApi();

  await loadFaceModels();

  /*
   * -------------------------------------------------------
   * ID CARD FACE
   * -------------------------------------------------------
   */

  let idResult = null;

  if (
    idImage instanceof
    HTMLImageElement
  ) {
    idResult =
      await detectIdFace(idImage);
  } else {
    /*
     * ถ้าไม่ได้ส่ง HTMLImageElement มา
     * ให้ตรวจภาพตามปกติ
     */

    try {
      idResult = await detectFace(
        idImage,
        512,
        0.15
      );
    } catch (error) {
      console.warn(
        "[Face Match] ID detection failed",
        error
      );
    }
  }

  /*
   * -------------------------------------------------------
   * SELFIE FACE
   * -------------------------------------------------------
   */

  let selfieResult = null;

  try {
    selfieResult =
      await detectFace(
        selfieImage,
        416,
        0.2
      );
  } catch (error) {
    console.warn(
      "[Face Match] Selfie detection failed",
      error
    );
  }

  /*
   * -------------------------------------------------------
   * VALIDATION
   * -------------------------------------------------------
   */

  if (!idResult) {
    throw new Error(
      "ไม่พบใบหน้าในรูปบัตรประชาชน"
    );
  }

  if (!selfieResult) {
    throw new Error(
      "ไม่พบใบหน้าในรูป Selfie"
    );
  }

  /*
   * -------------------------------------------------------
   * FACE DISTANCE
   * -------------------------------------------------------
   */

  const distance =
    api.euclideanDistance(
      idResult.descriptor,
      selfieResult.descriptor
    );

  /*
   * similarity
   *
   * distance 0 = เหมือนมาก
   * distance สูง = ต่างกัน
   */

  const similarity = Math.max(
    0,
    Math.min(
      1,
      1 - distance
    )
  );

  const confidence =
    confidenceFromDistance(
      distance
    );

  /*
   * -------------------------------------------------------
   * MATCH THRESHOLD
   * -------------------------------------------------------
   *
   * 0.6 เป็น threshold มาตรฐานที่เราใช้อยู่
   *
   * distance < 0.6
   * = ผ่าน
   */

  const matched =
    distance < 0.6;

  console.log(
    "[Face Match]",
    {
      distance,
      similarity,
      confidence,
      matched,
    }
  );

  return {
    matched,
    verified: matched,
    similarity,
    confidence,
    distance,
  };
}