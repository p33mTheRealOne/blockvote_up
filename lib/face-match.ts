let faceapi:
  | typeof import("@vladmandic/face-api")
  | null = null;

let modelsLoaded = false;

let modelsLoading: Promise<void> | null = null;

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

  if (!modelsLoading) {
    modelsLoading = Promise.all([
      api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
      .then(() => {
        modelsLoaded = true;
      })
      .catch((error) => {
        modelsLoading = null;

        throw error;
      });
  }

  await modelsLoading;
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
        inputSize: 416,
        scoreThreshold: 0.35,
      })
    )
    .withFaceLandmarks();

  if (!detection) {
    return null;
  }

  return detection.landmarks;
}

/* =========================================================
   DETECT FACE ON ID CARD (LIVE VIDEO)
   ใช้บอกผู้ใช้ตอนสแกนบัตรว่าเจอรูปหน้าบนบัตรหรือไม่
========================================================= */

export async function detectFaceOnCard(
  video: HTMLVideoElement
): Promise<boolean> {
  const api = await getFaceApi();

  await loadFaceModels();

  const width = video.videoWidth;

  if (!width) {
    return false;
  }

  const detections = await api.detectAllFaces(
    video,
    new api.TinyFaceDetectorOptions({
      inputSize: 416,
      scoreThreshold: 0.3,
    })
  );

  /*
   * รูปบนบัตรอยู่ฝั่งขวาของบัตร
   */
  return detections.some(
    (detection) =>
      detection.box.x +
        detection.box.width / 2 >
      width * 0.4
  );
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
   EXTRACT ID PHOTO
   หารูปใบหน้าบนบัตร -> ตัด -> ขยาย -> ทำให้ชัด
========================================================= */

type IdPhotoAttempt = {
  source: HTMLImageElement | HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
  scale: number;
  options: Array<{
    inputSize: 416 | 512 | 608;
    scoreThreshold: number;
  }>;
};

type IdPhotoBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function clampNumber(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(min, Math.min(max, value));
}

function enhanceIdPhoto(
  canvas: HTMLCanvasElement
): void {
  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  });

  if (!context) {
    return;
  }

  const { width, height } = canvas;

  const imageData = context.getImageData(
    0,
    0,
    width,
    height
  );

  const data = imageData.data;

  /*
   * 1) ปรับ contrast อัตโนมัติ (auto levels)
   */

  const histogram = new Uint32Array(256);

  for (let i = 0; i < data.length; i += 4) {
    const luminance = Math.round(
      0.299 * data[i] +
        0.587 * data[i + 1] +
        0.114 * data[i + 2]
    );

    histogram[luminance] += 1;
  }

  const totalPixels = width * height;

  let low = 0;
  let high = 255;
  let accumulated = 0;

  for (let i = 0; i < 256; i += 1) {
    accumulated += histogram[i];

    if (accumulated >= totalPixels * 0.01) {
      low = i;
      break;
    }
  }

  accumulated = 0;

  for (let i = 255; i >= 0; i -= 1) {
    accumulated += histogram[i];

    if (accumulated >= totalPixels * 0.01) {
      high = i;
      break;
    }
  }

  if (high - low > 20) {
    const stretch = 255 / (high - low);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = clampNumber(
        (data[i] - low) * stretch,
        0,
        255
      );

      data[i + 1] = clampNumber(
        (data[i + 1] - low) * stretch,
        0,
        255
      );

      data[i + 2] = clampNumber(
        (data[i + 2] - low) * stretch,
        0,
        255
      );
    }
  }

  /*
   * 2) Sharpen (unsharp แบบ Laplacian)
   */

  const source = new Uint8ClampedArray(data);
  const amount = 0.5;
  const rowStride = width * 4;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * rowStride + x * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const position = index + channel;

        const laplacian =
          4 * source[position] -
          source[position - 4] -
          source[position + 4] -
          source[position - rowStride] -
          source[position + rowStride];

        data[position] = clampNumber(
          source[position] + amount * laplacian,
          0,
          255
        );
      }
    }
  }

  context.putImageData(imageData, 0, 0);
}

export async function extractIdPhoto(
  source: HTMLImageElement
): Promise<string | null> {
  try {
    const api = await getFaceApi();

    await loadFaceModels();

    const width =
      source.naturalWidth || source.width;

    const height =
      source.naturalHeight || source.height;

    if (!width || !height) {
      return null;
    }

    /*
     * รูปบนบัตรมักเล็กและไม่ชัด
     * จึงตัดเป็นหลายบริเวณ -> ขยาย -> ปรับ contrast -> เพิ่มความคม
     * แล้วค่อยตรวจหาใบหน้า
     * (สร้างแบบ lazy เพื่อไม่สร้าง canvas ที่ไม่จำเป็น)
     */

    const createEnhancedRegion = (
      xRatio: number,
      yRatio: number,
      widthRatio: number,
      heightRatio: number
    ): IdPhotoAttempt => {
      const cropX = Math.floor(width * xRatio);
      const cropY = Math.floor(height * yRatio);

      const cropWidth = Math.max(
        1,
        Math.floor(width * widthRatio)
      );

      const cropHeight = Math.max(
        1,
        Math.floor(height * heightRatio)
      );

      const scale = Math.min(
        3,
        Math.max(1, 640 / cropHeight)
      );

      const canvas =
        document.createElement("canvas");

      canvas.width = Math.max(
        1,
        Math.round(cropWidth * scale)
      );

      canvas.height = Math.max(
        1,
        Math.round(cropHeight * scale)
      );

      const context =
        canvas.getContext("2d");

      if (!context) {
        throw new Error(
          "ไม่สามารถสร้าง Canvas สำหรับประมวลผลรูปบัตรได้"
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

      enhanceIdPhoto(canvas);

      return {
        source: canvas,
        offsetX: cropX,
        offsetY: cropY,
        scale,
        options: [
          { inputSize: 512, scoreThreshold: 0.15 },
          { inputSize: 608, scoreThreshold: 0.08 },
        ],
      };
    };

    const attempts: Array<
      () => IdPhotoAttempt
    > = [
      // ภาพดิบทั้งใบ (เร็วที่สุด)
      () => ({
        source,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        options: [
          { inputSize: 416, scoreThreshold: 0.2 },
        ],
      }),

      // ฝั่งขวาของบัตร (ตำแหน่งรูปปกติ)
      () => createEnhancedRegion(0.52, 0.03, 0.46, 0.94),

      // ฝั่งขวาแบบกว้าง
      () => createEnhancedRegion(0.45, 0, 0.55, 1),

      // กรณีบัตรอยู่กลางภาพหรือเล็กกว่ากรอบ
      () => createEnhancedRegion(0.3, 0.05, 0.5, 0.9),

      // ทั้งภาพที่ประมวลผลให้ชัดขึ้น
      () => createEnhancedRegion(0, 0, 1, 1),
    ];

    const detectBoxes = async (
      attempt: IdPhotoAttempt
    ): Promise<IdPhotoBox[]> => {
      for (const option of attempt.options) {
        const detections =
          await api.detectAllFaces(
            attempt.source,
            new api.TinyFaceDetectorOptions(
              option
            )
          );

        if (detections.length > 0) {
          /*
           * แปลงกรอบใบหน้ากลับมาเป็นพิกัดบนภาพบัตรต้นฉบับ
           */
          return detections.map(
            (detection) => ({
              x:
                attempt.offsetX +
                detection.box.x / attempt.scale,
              y:
                attempt.offsetY +
                detection.box.y / attempt.scale,
              width:
                detection.box.width /
                attempt.scale,
              height:
                detection.box.height /
                attempt.scale,
            })
          );
        }
      }

      return [];
    };

    let faceBox: IdPhotoBox | null = null;

    for (const createAttempt of attempts) {
      try {
        const boxes = await detectBoxes(
          createAttempt()
        );

        if (boxes.length === 0) {
          continue;
        }

        /*
         * รูปหลักบนบัตรอยู่ฝั่งขวาและใหญ่ที่สุด
         * (รูปเงาจางๆ เล็กกว่า)
         */

        const rightSide = boxes.filter(
          (box) =>
            box.x + box.width / 2 >
            width * 0.4
        );

        const candidates =
          rightSide.length > 0
            ? rightSide
            : boxes;

        faceBox = candidates.reduce(
          (best, box) =>
            box.width * box.height >
            best.width * best.height
              ? box
              : best
        );

        break;
      } catch (error) {
        console.warn(
          "[Face Match] ID photo search failed",
          error
        );
      }
    }

    if (!faceBox) {
      return null;
    }

    /*
     * ตัดรูปโดยเผื่อพื้นที่รอบใบหน้า (ผม คาง ไหล่)
     */

    const padX = faceBox.width * 0.45;
    const padTop = faceBox.height * 0.6;
    const padBottom = faceBox.height * 0.4;

    const left = clampNumber(
      faceBox.x - padX,
      0,
      width
    );

    const top = clampNumber(
      faceBox.y - padTop,
      0,
      height
    );

    const right = clampNumber(
      faceBox.x + faceBox.width + padX,
      0,
      width
    );

    const bottom = clampNumber(
      faceBox.y + faceBox.height + padBottom,
      0,
      height
    );

    const cropWidth = right - left;
    const cropHeight = bottom - top;

    if (cropWidth < 1 || cropHeight < 1) {
      return null;
    }

    /*
     * ขยายให้สูงประมาณ 720px (ขยายสูงสุด 6 เท่า)
     */

    const scale = Math.min(
      6,
      Math.max(1, 720 / cropHeight)
    );

    const canvas =
      document.createElement("canvas");

    canvas.width = Math.max(
      1,
      Math.round(cropWidth * scale)
    );

    canvas.height = Math.max(
      1,
      Math.round(cropHeight * scale)
    );

    const context =
      canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.drawImage(
      source,
      left,
      top,
      cropWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    /*
     * ทำให้ชัดขึ้น
     */

    enhanceIdPhoto(canvas);

    return canvas.toDataURL(
      "image/jpeg",
      0.95
    );
  } catch (error) {
    console.warn(
      "[Face Match] Extract ID photo failed",
      error
    );

    return null;
  }
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
