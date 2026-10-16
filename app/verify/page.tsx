"use client";
import {
  fetchVoterStatus,
} from "@/lib/solana-program";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createWorker, type Worker } from "tesseract.js";
import {
  Camera,
  RotateCcw,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ScanFace,
  AlertCircle,
  Loader2,
  Clock,
  Wallet,
} from "lucide-react";

import { extractValidCitizenId } from "@/lib/thai-id";
import {
  verifyFace,
  detectLandmarks,
  loadFaceModels,
  type FaceVerificationResult,
} from "@/lib/face-match";

import {
  computeMetrics,
  shuffleChallenges,
  averageBrightness,
  isBlink,
  eyesAreOpen,
  type Challenge,
} from "@/lib/liveness";

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
|
| ต้องตรงกับ election ที่ใช้ใน /vote/page.tsx
|
*/
const ELECTION_ID = 6;

/*
|--------------------------------------------------------------------------
| Types
|--------------------------------------------------------------------------
*/

type ScanStatus =
  | "checking-wallet"
  | "checking-election"
  | "not-started"
  | "ended"
  | "camera"
  | "captured"
  | "loading-face-models"
  | "face-scan"
  | "face-checking"
  | "face-verified"
  | "face-failed";

type ElectionStatus = {
  canVerify: boolean;
  state: "not-started" | "active" | "ended";
  startUnix: number;
  endUnix: number;
  name?: string;
};

type WindowWithSolana = Window & {
  solana?: {
    isPhantom?: boolean;
    publicKey?: {
      toString(): string;
    };
    connect(options?: {
      onlyIfTrusted?: boolean;
    }): Promise<{
      publicKey: {
        toString(): string;
      };
    }>;
    disconnect?: () => Promise<void>;
  };
};

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function formatDate(unix: number): string {
  if (!unix) return "-";

  return new Date(unix * 1000).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function challengeLabel(challenge: Challenge): string {
  switch (challenge) {
    case "LEFT":
      return "หันหน้าไปทางซ้าย";

    case "RIGHT":
      return "หันหน้าไปทางขวา";

    case "UP":
      return "เงยหน้าขึ้น";

    case "DOWN":
      return "ก้มหน้าลง";

    case "BLINK":
      return "กระพริบตา";

    default:
      return "ทำตามคำแนะนำ";
  }
}

function challengeIcon(challenge: Challenge): string {
  switch (challenge) {
    case "LEFT":
      return "←";

    case "RIGHT":
      return "→";

    case "UP":
      return "↑";

    case "DOWN":
      return "↓";

    case "BLINK":
      return "👁";

    default:
      return "";
  }
}

function maskWallet(address: string): string {
  if (address.length <= 12) return address;

  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

async function dataUrlToImage(
  dataUrl: string
): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);

    image.onerror = () =>
      reject(new Error("ไม่สามารถโหลดรูปภาพที่ถ่ายไว้ได้"));

    image.src = dataUrl;
  });
}

/*
|--------------------------------------------------------------------------
| Page
|--------------------------------------------------------------------------
*/

export default function VerifyPage() {
  const router = useRouter();

  /*
  |--------------------------------------------------------------------------
  | ID card camera
  |--------------------------------------------------------------------------
  */

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ocrCanvasRef = useRef<HTMLCanvasElement>(null);

  const streamRef = useRef<MediaStream | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const scanTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const busyRef = useRef(false);

  /*
  |--------------------------------------------------------------------------
  | Selfie camera
  |--------------------------------------------------------------------------
  */

  const selfieVideoRef =
    useRef<HTMLVideoElement>(null);

  const selfieCanvasRef =
    useRef<HTMLCanvasElement>(null);

  const brightnessCanvasRef =
    useRef<HTMLCanvasElement>(null);

  const selfieStreamRef =
    useRef<MediaStream | null>(null);

  const faceScanTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const faceBusyRef = useRef(false);

  /*
  |--------------------------------------------------------------------------
  | Liveness
  |--------------------------------------------------------------------------
  */

  const baselineRef =
    useRef<{
      yaw: number;
      pitch: number;
    } | null>(null);

  const calibSamplesRef =
    useRef<
      {
        yaw: number;
        pitch: number;
      }[]
    >([]);

  const challengeOrderRef =
    useRef<Challenge[]>([]);

  const holdCounterRef =
    useRef(0);

  const blinkWasClosedRef =
    useRef(false);

  const captureStartedRef =
    useRef(false);

  /*
  |--------------------------------------------------------------------------
  | State
  |--------------------------------------------------------------------------
  */

  const [status, setStatus] =
    useState<ScanStatus>("checking-wallet");

  const [walletAddress, setWalletAddress] =
    useState<string | null>(null);

  const [electionStatus, setElectionStatus] =
    useState<ElectionStatus | null>(null);

  const [capturedImage, setCapturedImage] =
    useState<string | null>(null);

  const [idNumber, setIdNumber] =
    useState("");

  const [scanHint, setScanHint] =
    useState("กำลังเปิดกล้อง…");

  const [cameraError, setCameraError] =
    useState<string | null>(null);

  const [selfieImage, setSelfieImage] =
    useState<string | null>(null);

  const [faceHint, setFaceHint] =
    useState("กำลังเตรียมกล้องหน้า…");

  const [faceResult, setFaceResult] =
    useState<FaceVerificationResult | null>(null);

  const [submitting, setSubmitting] =
    useState(false);

  const [submitError, setSubmitError] =
    useState<string | null>(null);

  const [livenessPhase, setLivenessPhase] =
    useState<
      "calibrating" | Challenge | "passed"
    >("calibrating");

  const [completedChallenges, setCompletedChallenges] =
    useState<Challenge[]>([]);

  /*
  |--------------------------------------------------------------------------
  | Cleanup
  |--------------------------------------------------------------------------
  */

  const stopIdCamera = useCallback(() => {
    streamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    streamRef.current = null;

    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, []);

  const stopSelfieCamera = useCallback(() => {
    selfieStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    selfieStreamRef.current = null;

    if (faceScanTimerRef.current) {
      clearInterval(faceScanTimerRef.current);
      faceScanTimerRef.current = null;
    }
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Wallet guard
  |--------------------------------------------------------------------------
  */

    useEffect(() => {
    let cancelled = false;

    async function checkWallet() {
        const provider =
        typeof window !== "undefined"
            ? (window as WindowWithSolana).solana
            : null;

        if (!provider?.isPhantom) {
        if (!cancelled) {
            router.replace("/");
        }

        return;
        }

        let address: string;

        try {
        const response =
            await provider.connect({
            onlyIfTrusted: true,
            });

        address =
            response.publicKey.toString();

        const voterStatus =
        await fetchVoterStatus(address);

        if (voterStatus?.verified) {
        router.replace("/vote");
        return;
        }
        } catch {
        if (!cancelled) {
            router.replace("/");
        }

        return;
        }

        if (cancelled) return;

        setWalletAddress(address);

        setStatus("checking-election");
    }

    checkWallet();

    return () => {
        cancelled = true;
    };
    }, [router]);

  /*
  |--------------------------------------------------------------------------
  | Election status
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (status !== "checking-election") {
      return;
    }

    let cancelled = false;

    async function checkElection() {
      try {
        const response = await fetch(
          `/api/election-status?electionId=${ELECTION_ID}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data =
          (await response.json()) as ElectionStatus & {
            error?: string;
          };

        if (!response.ok) {
          throw new Error(
            data.error ||
              "ไม่สามารถตรวจสอบสถานะการเลือกตั้งได้"
          );
        }

        if (cancelled) return;

        setElectionStatus(data);

        if (data.state === "not-started") {
          setStatus("not-started");
          return;
        }

        if (data.state === "ended") {
          setStatus("ended");
          return;
        }

        setStatus("camera");
      } catch (error) {
        console.error(
          "Election status error:",
          error
        );

        if (!cancelled) {
          setCameraError(
            error instanceof Error
              ? error.message
              : "ไม่สามารถตรวจสอบสถานะการเลือกตั้งได้"
          );

          setStatus("not-started");
        }
      }
    }

    checkElection();

    return () => {
      cancelled = true;
    };
  }, [status]);

  /*
  |--------------------------------------------------------------------------
  | ID card camera
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (status !== "camera") {
      return;
    }

    let cancelled = false;

    async function startCamera() {
      try {
        setCameraError(null);
        setScanHint("กำลังเปิดกล้อง…");

        const stream =
          await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: {
                ideal: "environment",
              },
              width: {
                ideal: 1280,
              },
              height: {
                ideal: 720,
              },
            },
            audio: false,
          });

        if (cancelled) {
          stream
            .getTracks()
            .forEach((track) =>
              track.stop()
            );

          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject =
            stream;

          await videoRef.current.play();
        }

        setScanHint(
          "วางบัตรประชาชนให้อยู่ในกรอบ"
        );
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setCameraError(
            "ไม่สามารถเข้าถึงกล้องได้ กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์"
          );
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;

      streamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());

      streamRef.current = null;
    };
  }, [status]);

  /*
  |--------------------------------------------------------------------------
  | OCR worker
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    let cancelled = false;

    async function initWorker() {
      try {
        const worker =
          await createWorker("eng");

        if (cancelled) {
          await worker.terminate();
          return;
        }

        workerRef.current = worker;
      } catch (error) {
        console.error(
          "Tesseract initialization failed:",
          error
        );
      }
    }

    initWorker();

    return () => {
      cancelled = true;

      workerRef.current
        ?.terminate()
        .catch(() => {});

      workerRef.current = null;
    };
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Capture ID card frame
  |--------------------------------------------------------------------------
  */

  const captureFrame =
    useCallback((): string | null => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (
        !video ||
        !canvas ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return null;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context =
        canvas.getContext("2d");

      if (!context) {
        return null;
      }

      context.filter = "none";

      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      return canvas.toDataURL(
        "image/jpeg",
        0.92
      );
    }, []);

  /*
  |--------------------------------------------------------------------------
  | OCR frame
  |--------------------------------------------------------------------------
  */

  const captureFrameForOcr =
    useCallback((): string | null => {
      const video = videoRef.current;
      const canvas =
        ocrCanvasRef.current;

      if (
        !video ||
        !canvas ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return null;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context =
        canvas.getContext("2d");

      if (!context) {
        return null;
      }

      context.filter =
        "grayscale(1) blur(0.6px) contrast(1.15)";

      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      context.filter = "none";

      return canvas.toDataURL(
        "image/jpeg",
        0.92
      );
    }, []);

  /*
  |--------------------------------------------------------------------------
  | Finish ID capture
  |--------------------------------------------------------------------------
  */

  const finishCapture =
    useCallback(
      (
        dataUrl: string,
        detectedId: string
      ) => {
        stopIdCamera();

        setCapturedImage(dataUrl);
        setIdNumber(detectedId);

        setCameraError(null);

        setStatus("captured");
      },
      [stopIdCamera]
    );

  /*
  |--------------------------------------------------------------------------
  | OCR auto scan
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (status !== "camera") {
      return;
    }

    scanTimerRef.current =
      setInterval(async () => {
        if (
          busyRef.current ||
          !workerRef.current
        ) {
          return;
        }

        const ocrFrame =
          captureFrameForOcr();

        if (!ocrFrame) {
          return;
        }

        busyRef.current = true;

        try {
          const worker =
            workerRef.current;

          if (!worker) {
            return;
          }

          const result =
            await worker.recognize(
              ocrFrame
            );

          const text =
            result.data.text;

          const found =
            extractValidCitizenId(text);

          if (found) {
            setScanHint(
              `ตรวจพบเลขบัตรที่ถูกต้อง: ${found}`
            );

            const fullFrame =
              captureFrame();

            if (fullFrame) {
              finishCapture(
                fullFrame,
                found
              );
            }
          } else {
            setScanHint(
              "วางบัตรประชาชนให้อยู่ในกรอบ และให้แสงเพียงพอ"
            );
          }
        } catch (error) {
          console.error(
            "OCR error:",
            error
          );
        } finally {
          busyRef.current = false;
        }
      }, 1400);

    return () => {
      if (scanTimerRef.current) {
        clearInterval(
          scanTimerRef.current
        );

        scanTimerRef.current = null;
      }
    };
  }, [
    status,
    captureFrame,
    captureFrameForOcr,
    finishCapture,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Manual capture
  |--------------------------------------------------------------------------
  */

  function handleManualCapture() {
    const image = captureFrame();

    if (!image) {
      setCameraError(
        "ยังไม่สามารถถ่ายภาพจากกล้องได้"
      );

      return;
    }

    /*
     * ถ่ายภาพก่อน แต่ถ้า OCR ยังไม่เจอ
     * ให้ผู้ใช้กรอกเลขเองได้
     */
    finishCapture(image, idNumber);
  }

  /*
  |--------------------------------------------------------------------------
  | Retake ID
  |--------------------------------------------------------------------------
  */

  function handleRetake() {
    stopIdCamera();

    setCapturedImage(null);
    setIdNumber("");
    setCameraError(null);
    setScanHint(
      "วางบัตรประชาชนให้อยู่ในกรอบ"
    );

    setStatus("camera");
  }

  /*
  |--------------------------------------------------------------------------
  | Continue to face verification
  |--------------------------------------------------------------------------
  */

  function handleContinue() {
    if (idNumber.length !== 13) {
      return;
    }

    setSubmitError(null);
    setFaceResult(null);
    setSelfieImage(null);

    setStatus("loading-face-models");
  }

  /*
  |--------------------------------------------------------------------------
  | Load face models
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (
      status !== "loading-face-models"
    ) {
      return;
    }

    let cancelled = false;

    async function prepareFaceModels() {
      try {
        await loadFaceModels();

        if (cancelled) return;

        baselineRef.current = null;
        calibSamplesRef.current = [];

        challengeOrderRef.current = [];

        holdCounterRef.current = 0;
        blinkWasClosedRef.current = false;
        captureStartedRef.current = false;

        setCompletedChallenges([]);

        setLivenessPhase("calibrating");

        setFaceHint(
          "จัดใบหน้าให้อยู่ในกรอบวงรี"
        );

        setStatus("face-scan");
      } catch (error) {
        console.error(
          "Face model loading failed:",
          error
        );

        if (!cancelled) {
          setFaceHint(
            "โหลดโมเดลตรวจจับใบหน้าไม่สำเร็จ กรุณารีเฟรชหน้าเว็บ"
          );

          setStatus("face-failed");
        }
      }
    }

    prepareFaceModels();

    return () => {
      cancelled = true;
    };
  }, [status]);

  /*
  |--------------------------------------------------------------------------
  | Selfie camera
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (status !== "face-scan") {
      return;
    }

    let cancelled = false;

    async function startSelfieCamera() {
      try {
        const stream =
          await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: {
                ideal: "user",
              },
              width: {
                ideal: 1280,
              },
              height: {
                ideal: 720,
              },
            },
            audio: false,
          });

        if (cancelled) {
          stream
            .getTracks()
            .forEach((track) =>
              track.stop()
            );

          return;
        }

        selfieStreamRef.current =
          stream;

        if (selfieVideoRef.current) {
          selfieVideoRef.current.srcObject =
            stream;

          await selfieVideoRef.current.play();
        }

        setFaceHint(
          "อยู่นิ่ง ๆ และมองตรงกล้อง"
        );
      } catch (error) {
        console.error(
          "Selfie camera error:",
          error
        );

        if (!cancelled) {
          setFaceHint(
            "ไม่สามารถเข้าถึงกล้องหน้าได้ กรุณาอนุญาตการใช้กล้อง"
          );
        }
      }
    }

    startSelfieCamera();

    return () => {
      cancelled = true;

      selfieStreamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop()
        );

      selfieStreamRef.current = null;
    };
  }, [status]);

  /*
  |--------------------------------------------------------------------------
  | Capture selfie
  |--------------------------------------------------------------------------
  */

  const captureSelfieFrame =
    useCallback((): string | null => {
      const video =
        selfieVideoRef.current;

      const canvas =
        selfieCanvasRef.current;

      if (
        !video ||
        !canvas ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return null;
      }

      canvas.width =
        video.videoWidth;

      canvas.height =
        video.videoHeight;

      const context =
        canvas.getContext("2d");

      if (!context) {
        return null;
      }

      /*
       * วาดภาพแบบปกติ
       * ไม่ต้อง mirror ภาพจริง เพราะ descriptor
       * ไม่จำเป็นต้อง mirror
       */
      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      return canvas.toDataURL(
        "image/jpeg",
        0.92
      );
    }, []);

  /*
  |--------------------------------------------------------------------------
  | Face match
  |--------------------------------------------------------------------------
  */

  const runFaceMatch =
    useCallback(
      async (selfieDataUrl: string) => {
        if (!capturedImage) {
          return;
        }

        setStatus("face-checking");

        stopSelfieCamera();

        try {
          const idImage =
            await dataUrlToImage(
              capturedImage
            );

          const selfieImageElement =
            await dataUrlToImage(
              selfieDataUrl
            );

          const result =
            await verifyFace(
              idImage,
              selfieImageElement
            );

          setFaceResult(result);

          if (result.verified) {
            setStatus(
              "face-verified"
            );
          } else {
            setStatus(
              "face-failed"
            );
          }
        } catch (error) {
          console.error(
            "Face verification error:",
            error
          );

          setFaceResult(null);

          setFaceHint(
            error instanceof Error
              ? error.message
              : "ตรวจสอบใบหน้าไม่สำเร็จ"
          );

          setStatus(
            "face-failed"
          );
        }
      },
      [
        capturedImage,
        stopSelfieCamera,
      ]
    );

  /*
  |--------------------------------------------------------------------------
  | Reset liveness
  |--------------------------------------------------------------------------
  */

  function resetLivenessProgress(
    hint: string
  ) {
    baselineRef.current = null;

    calibSamplesRef.current = [];

    challengeOrderRef.current = [];

    holdCounterRef.current = 0;

    blinkWasClosedRef.current = false;

    captureStartedRef.current = false;

    setCompletedChallenges([]);

    setLivenessPhase(
      "calibrating"
    );

    setFaceHint(hint);
  }

  /*
  |--------------------------------------------------------------------------
  | Liveness engine
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (status !== "face-scan") {
      return;
    }

    faceScanTimerRef.current =
      setInterval(async () => {
        if (faceBusyRef.current) {
          return;
        }

        const video =
          selfieVideoRef.current;

        const brightnessCanvas =
          brightnessCanvasRef.current;

        if (
          !video ||
          !brightnessCanvas ||
          video.videoWidth === 0 ||
          video.videoHeight === 0
        ) {
          return;
        }

        faceBusyRef.current = true;

        try {
          /*
           * ---------------------------------------------------------------
           * Brightness
           * ---------------------------------------------------------------
           */

          brightnessCanvas.width = 64;
          brightnessCanvas.height = 64;

          const context =
            brightnessCanvas.getContext(
              "2d"
            );

          if (context) {
            context.drawImage(
              video,
              0,
              0,
              64,
              64
            );

            const imageData =
              context.getImageData(
                0,
                0,
                64,
                64
              );

            const brightness =
              averageBrightness(
                imageData
              );

            /*
             * ใช้ช่วงกว้างพอสมควร
             * เพื่อไม่ให้ห้องทั่วไปผ่านยากเกินไป
             */
            if (brightness < 25) {
              setFaceHint(
                "แสงน้อยเกินไป กรุณาเพิ่มแสง"
              );

              return;
            }

            if (brightness > 245) {
              setFaceHint(
                "แสงจ้าเกินไป กรุณาหลีกเลี่ยงแสงย้อน"
              );

              return;
            }
          }

          /*
           * ---------------------------------------------------------------
           * Face landmarks
           * ---------------------------------------------------------------
           */

          const landmarks =
            await detectLandmarks(
              video
            );

          if (!landmarks) {
            if (
              livenessPhase !==
                "calibrating" ||
              calibSamplesRef.current
                .length > 0
            ) {
              resetLivenessProgress(
                "ไม่พบใบหน้า เริ่มการตรวจสอบใหม่"
              );
            } else {
              setFaceHint(
                "ไม่พบใบหน้า กรุณาจัดใบหน้าให้อยู่ในกรอบ"
              );
            }

            return;
          }

          /*
           * ---------------------------------------------------------------
           * Metrics
           * ---------------------------------------------------------------
           */

          const positions =
            landmarks.positions;

          const metrics =
            computeMetrics(
              positions
            );

          /*
           * ---------------------------------------------------------------
           * Calibration
           * ---------------------------------------------------------------
           */

            if (livenessPhase === "calibrating") {
            baselineRef.current = {
                yaw: metrics.yaw,
                pitch: metrics.pitch,
            };

            const allChallenges = shuffleChallenges();

            const order = allChallenges.filter(
                (challenge) =>
                challenge === "LEFT" ||
                challenge === "RIGHT" ||
                challenge === "BLINK"
            );

            challengeOrderRef.current = order;

            holdCounterRef.current = 0;
            blinkWasClosedRef.current = false;

            const first = order[0];

            if (first) {
                setLivenessPhase(first);

                setFaceHint(
                `${challengeIcon(first)} ${challengeLabel(first)}`
                );
            }

            return;
            }

          /*
           * ---------------------------------------------------------------
           * Baseline
           * ---------------------------------------------------------------
           */

          const baseline =
            baselineRef.current;

          if (!baseline) {
            return;
          }

          /*
           * ---------------------------------------------------------------
           * All challenges completed
           * ---------------------------------------------------------------
           */

            if (livenessPhase === "passed") {
            if (captureStartedRef.current) {
                return;
            }

            captureStartedRef.current = true;

            setFaceHint(
                "✓ ตรวจสอบการเคลื่อนไหวผ่าน กำลังถ่ายภาพ..."
            );

            const shot = captureSelfieFrame();

            if (shot) {
                setSelfieImage(shot);
                await runFaceMatch(shot);
            } else {
                captureStartedRef.current = false;

                setFaceHint(
                "ไม่สามารถถ่ายภาพได้ กรุณาลองใหม่"
                );
            }

            return;
            }

          /*
           * ---------------------------------------------------------------
           * Current challenge
           * ---------------------------------------------------------------
           */

          const currentChallenge =
            livenessPhase;

          if (
            typeof currentChallenge !==
            "string"
          ) {
            return;
          }

          let satisfied = false;

          /*
           * ใช้ baseline เพื่อวัดการเคลื่อนไหว
           * โดยตรง
           */
          switch (
            currentChallenge
          ) {
            case "LEFT":
            satisfied =
                metrics.yaw <
                baseline.yaw - 0.07;
            break;

            case "RIGHT":
            satisfied =
                metrics.yaw >
                baseline.yaw + 0.07;
            break;

            case "BLINK":
            if (isBlink(metrics)) {
                blinkWasClosedRef.current = true;
            } else if (
                blinkWasClosedRef.current &&
                eyesAreOpen(metrics)
            ) {
                satisfied = true;
            }
            break;

          }

          /*
           * ---------------------------------------------------------------
           * Hold detection
           * ---------------------------------------------------------------
           */

          if (satisfied) {
            holdCounterRef.current += 1;
          } else if (
            currentChallenge !==
            "BLINK"
          ) {
            holdCounterRef.current = 0;
          }

          const requiredHold = 1;

          /*
           * ---------------------------------------------------------------
           * Challenge completed
           * ---------------------------------------------------------------
           */

          if (
            holdCounterRef.current >=
            requiredHold
          ) {
            holdCounterRef.current = 0;

            blinkWasClosedRef.current =
              false;

            setCompletedChallenges(
              (previous) => [
                ...previous,
                currentChallenge,
              ]
            );

            const currentIndex =
              challengeOrderRef.current.indexOf(
                currentChallenge
              );

            const next =
              challengeOrderRef.current[
                currentIndex + 1
              ];

            if (next) {
            setLivenessPhase(next);

            setFaceHint(
                `${challengeIcon(next)} ${challengeLabel(next)}`
            );
            } else {
            setLivenessPhase("passed");

            setFaceHint(
                "✓ ตรวจสอบการเคลื่อนไหวครบแล้ว"
            );
            }
          } else {
            setFaceHint(
              `${challengeIcon(
                currentChallenge
              )} ${challengeLabel(
                currentChallenge
              )}`
            );
          }
        } catch (error) {
          console.error(
            "Liveness error:",
            error
          );
        } finally {
          faceBusyRef.current = false;
        }
      }, 350);

    return () => {
      if (faceScanTimerRef.current) {
        clearInterval(
          faceScanTimerRef.current
        );

        faceScanTimerRef.current = null;
      }
    };
  }, [
    status,
    livenessPhase,
    captureSelfieFrame,
    runFaceMatch,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Retake face
  |--------------------------------------------------------------------------
  */

  function handleRetakeFace() {
    stopSelfieCamera();

    setSelfieImage(null);
    setFaceResult(null);
    setSubmitError(null);

    resetLivenessProgress(
      "จัดใบหน้าให้อยู่ในกรอบวงรี"
    );

    setStatus("face-scan");
  }

  /*
  |--------------------------------------------------------------------------
  | Finish verification
  |--------------------------------------------------------------------------
  */

  async function handleFinish() {
    if (
      !walletAddress ||
      idNumber.length !== 13 ||
      !faceResult?.verified
    ) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      /*
       * ตรวจ Election อีกครั้งก่อนส่ง
       */
      const electionResponse =
        await fetch(
          `/api/election-status?electionId=${ELECTION_ID}`,
          {
            method: "GET",
            cache: "no-store",
          }
        );

      const electionData =
        await electionResponse.json();

      if (
        !electionResponse.ok ||
        !electionData.canVerify
      ) {
        setSubmitError(
          electionData.error ||
            "ขณะนี้ไม่อยู่ในช่วงเวลาที่สามารถยืนยันตัวตนได้"
        );

        setSubmitting(false);

        return;
      }

      /*
       * ส่งไป server
       *
       * สำคัญ:
       * walletAddress ถูกใช้เพื่อ register on-chain
       * แต่ API จะไม่บันทึก wallet ลง Supabase
       */
      const response =
        await fetch(
          "/api/verify-voter",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              electionId:
                ELECTION_ID,

              walletAddress,

              idNumber,

              faceSimilarity:
                faceResult.similarity,

              faceConfidence:
                faceResult.confidence,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        setSubmitError(
          data.error ||
            "เกิดข้อผิดพลาด กรุณาลองใหม่"
        );

        setSubmitting(false);

        return;
      }

      /*
       * สำเร็จ
       */
      router.replace("/vote");
    } catch (error) {
      console.error(
        "Verification submit error:",
        error
      );

      setSubmitError(
        "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่"
      );

      setSubmitting(false);
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Checking wallet
  |--------------------------------------------------------------------------
  */

  if (
    status ===
    "checking-wallet"
  ) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-blue-100 shadow-xl p-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
            <Wallet
              className="text-blue-600"
              size={30}
            />
          </div>

          <h1 className="text-xl font-bold text-slate-800">
            กำลังตรวจสอบ Wallet
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            กรุณารอสักครู่…
          </p>

          <Loader2
            className="mx-auto mt-5 animate-spin text-blue-600"
            size={24}
          />
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Checking election
  |--------------------------------------------------------------------------
  */

  if (
    status ===
    "checking-election"
  ) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-blue-100 shadow-xl p-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
            <Clock
              className="text-blue-600"
              size={30}
            />
          </div>

          <h1 className="text-xl font-bold text-slate-800">
            กำลังตรวจสอบการเลือกตั้ง
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            กำลังตรวจสอบช่วงเวลาที่สามารถยืนยันตัวตนได้
          </p>

          <Loader2
            className="mx-auto mt-5 animate-spin text-blue-600"
            size={24}
          />
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Election not started
  |--------------------------------------------------------------------------
  */

  if (
    status ===
    "not-started"
  ) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-blue-100 shadow-xl p-8">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
            <Clock
              className="text-blue-600"
              size={30}
            />
          </div>

          <h1 className="text-2xl font-bold text-center text-slate-800">
            ยังไม่ถึงเวลา
          </h1>

          <p className="mt-3 text-center text-sm leading-6 text-slate-500">
            ขณะนี้ยังไม่สามารถยืนยันตัวตนเพื่อเลือกตั้งได้
          </p>

          {electionStatus && (
            <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
              <div>
                <p className="text-xs text-slate-400">
                  การเลือกตั้ง
                </p>

                <p className="mt-1 font-semibold text-slate-700">
                  {electionStatus.name ||
                    `Election #${ELECTION_ID}`}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-400">
                  เริ่มยืนยันตัวตน
                </p>

                <p className="mt-1 text-sm text-slate-600">
                  {formatDate(
                    electionStatus.startUnix
                  )}
                </p>
              </div>

              <div>
                <p className="text-xs text-slate-400">
                  สิ้นสุด
                </p>

                <p className="mt-1 text-sm text-slate-600">
                  {formatDate(
                    electionStatus.endUnix
                  )}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={() =>
              router.replace("/")
            }
            className="mt-6 w-full rounded-2xl bg-blue-600 py-3.5 font-semibold text-white hover:bg-blue-700 transition"
          >
            กลับหน้าหลัก
          </button>
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Election ended
  |--------------------------------------------------------------------------
  */

  if (
    status ===
    "ended"
  ) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl border border-blue-100 shadow-xl p-8">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
            <Clock
              className="text-red-500"
              size={30}
            />
          </div>

          <h1 className="text-2xl font-bold text-center text-slate-800">
            การเลือกตั้งสิ้นสุดแล้ว
          </h1>

          <p className="mt-3 text-center text-sm leading-6 text-slate-500">
            ไม่สามารถยืนยันตัวตนหรือลงทะเบียนผู้มีสิทธิ์ได้อีก
          </p>

          {electionStatus && (
            <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs text-slate-400">
                สิ้นสุดการเลือกตั้ง
              </p>

              <p className="mt-1 text-sm font-medium text-slate-700">
                {formatDate(
                  electionStatus.endUnix
                )}
              </p>
            </div>
          )}

          <button
            onClick={() =>
              router.replace("/")
            }
            className="mt-6 w-full rounded-2xl bg-blue-600 py-3.5 font-semibold text-white hover:bg-blue-700 transition"
          >
            กลับหน้าหลัก
          </button>
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Main UI
  |--------------------------------------------------------------------------
  */

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-blue-100 p-6 sm:p-8">

        {/* Header */}
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
            <ShieldCheck
              className="text-blue-600"
              size={30}
            />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center text-slate-800">
          {status === "captured" ||
          status ===
            "loading-face-models" ||
          status === "face-scan" ||
          status === "face-checking" ||
          status ===
            "face-verified" ||
          status === "face-failed"
            ? "ยืนยันตัวตน"
            : "สแกนบัตรประชาชน"}
        </h1>

        <p className="text-center text-slate-500 mt-2 text-sm">
          {status === "camera"
            ? "วางบัตรประชาชนให้อยู่ในกรอบ ระบบจะอ่านเลขบัตรอัตโนมัติ"
            : status ===
                "captured"
              ? "ตรวจสอบข้อมูลบัตรก่อนดำเนินการต่อ"
              : status ===
                  "loading-face-models"
                ? "กำลังเตรียมระบบตรวจสอบใบหน้า"
                : status ===
                    "face-scan" ||
                  status ===
                    "face-checking"
                ? "ทำตามคำสั่งบนหน้าจอเพื่อยืนยันว่าเป็นบุคคลจริง"
                : status ===
                    "face-verified" ||
                  status ===
                    "face-failed"
                  ? "ตรวจสอบผลการเปรียบเทียบใบหน้า"
                  : ""}
        </p>

        {/* Wallet */}
        {walletAddress && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <Wallet
              size={14}
              className="text-blue-500"
            />

            <span className="text-xs font-mono text-slate-500">
              {maskWallet(
                walletAddress
              )}
            </span>
          </div>
        )}

        {/* Content */}
        <div className="mt-6">

          {/* ID CAMERA */}
          {status === "camera" && (
            <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-900">

              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover"
              />

              {/* ID card guide */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-[82%] aspect-[1.586/1]">

                  <div className="absolute inset-0 rounded-xl border-2 border-white/70" />

                  <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />

                  <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />

                  <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />

                  <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />
                </div>
              </div>

              {/* Hint */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent p-3">
                <p className="text-white text-xs text-center font-medium">
                  {cameraError ||
                    scanHint}
                </p>
              </div>
            </div>
          )}

          {/* CAPTURED ID */}
          {status === "captured" &&
            capturedImage && (
              <div>

                <div className="relative w-full aspect-[1.586/1] rounded-2xl overflow-hidden border border-slate-200 bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={capturedImage}
                    alt="Thai national ID card"
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="mt-4 flex items-start gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                  <CheckCircle2
                    className="text-green-600 shrink-0 mt-0.5"
                    size={18}
                  />

                  <div className="text-sm min-w-0">
                    <p className="font-semibold text-green-700">
                      ถ่ายภาพบัตรสำเร็จ
                    </p>

                    <p className="text-slate-600 font-mono text-xs mt-1 break-all">
                      {idNumber ||
                        "ยังไม่พบเลขบัตร"}
                    </p>
                  </div>
                </div>

                {!idNumber && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      เลขบัตรประชาชน
                    </label>

                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="กรอกเลขบัตร 13 หลัก"
                      maxLength={13}
                      value={idNumber}
                      onChange={(event) =>
                        setIdNumber(
                          event.target.value.replace(
                            /\D/g,
                            ""
                          )
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                )}

                {idNumber &&
                  idNumber.length !== 13 && (
                    <p className="mt-2 text-xs text-red-500">
                      เลขบัตรต้องมี 13 หลัก
                    </p>
                  )}
              </div>
            )}

          {/* FACE MODEL LOADING */}
          {status ===
            "loading-face-models" && (
            <div className="flex flex-col items-center justify-center gap-4 py-16">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
                <Loader2
                  className="animate-spin text-blue-600"
                  size={28}
                />
              </div>

              <div className="text-center">
                <p className="font-semibold text-slate-700">
                  กำลังโหลดระบบตรวจจับใบหน้า
                </p>

                <p className="mt-1 text-xs text-slate-400">
                  ครั้งแรกอาจใช้เวลาสักครู่
                </p>
              </div>
            </div>
          )}

          {/* FACE SCAN */}
          {(status === "face-scan" ||
            status ===
              "face-checking") && (
            <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-900">

              <video
                ref={selfieVideoRef}
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover -scale-x-100"
              />

              {/* Face oval */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[58%] aspect-[3/4] rounded-[50%] border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.18)]" />
              </div>

              {/* Challenge progress */}
              {status === "face-scan" &&
                challengeOrderRef.current
                  .length > 0 && (
                  <div className="absolute top-4 left-0 right-0 flex justify-center gap-2">
                    {challengeOrderRef.current.map(
                      (
                        challenge
                      ) => {
                        const completed =
                          completedChallenges.includes(
                            challenge
                          );

                        const current =
                          challenge ===
                          livenessPhase;

                        return (
                          <div
                            key={
                              challenge
                            }
                            className={`h-2.5 w-2.5 rounded-full transition-all ${
                              completed
                                ? "bg-green-400"
                                : current
                                  ? "bg-blue-400 scale-125"
                                  : "bg-white/40"
                            }`}
                          />
                        );
                      }
                    )}
                  </div>
                )}

              {/* Challenge */}
              {status === "face-scan" &&
                livenessPhase !==
                  "calibrating" &&
                livenessPhase !==
                  "passed" && (
                  <div className="absolute top-12 left-1/2 -translate-x-1/2">
                    <div className="rounded-2xl bg-black/55 backdrop-blur-sm px-5 py-3 text-center text-white">
                      <div className="text-3xl leading-none">
                        {challengeIcon(
                          livenessPhase
                        )}
                      </div>

                      <p className="mt-2 text-sm font-semibold whitespace-nowrap">
                        {challengeLabel(
                          livenessPhase
                        )}
                      </p>
                    </div>
                  </div>
                )}

              {/* Bottom hint */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                <p className="text-white text-xs text-center font-medium flex items-center justify-center gap-2">
                  {status ===
                    "face-checking" && (
                    <Loader2
                      className="animate-spin"
                      size={14}
                    />
                  )}

                  {status ===
                  "face-checking"
                    ? "กำลังเปรียบเทียบใบหน้ากับบัตรประชาชน…"
                    : faceHint}
                </p>
              </div>
            </div>
          )}

          {/* FACE RESULT */}
          {(status ===
            "face-verified" ||
            status ===
              "face-failed") &&
            selfieImage && (
              <div>

                <div className="grid grid-cols-2 gap-3">

                  <div className="relative aspect-[1.586/1] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        capturedImage ??
                        undefined
                      }
                      alt="ID card"
                      className="h-full w-full object-cover"
                    />

                    <div className="absolute bottom-0 inset-x-0 bg-black/55 px-2 py-1.5">
                      <p className="text-white text-[10px] text-center">
                        บัตรประชาชน
                      </p>
                    </div>
                  </div>

                  <div className="relative aspect-[1.586/1] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selfieImage}
                      alt="Selfie"
                      className="h-full w-full object-cover"
                    />

                    <div className="absolute bottom-0 inset-x-0 bg-black/55 px-2 py-1.5">
                      <p className="text-white text-[10px] text-center">
                        Selfie
                      </p>
                    </div>
                  </div>

                </div>

                <div
                  className={`mt-4 flex items-start gap-3 rounded-xl border px-4 py-3 ${
                    status ===
                    "face-verified"
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  }`}
                >
                  {status ===
                  "face-verified" ? (
                    <CheckCircle2
                      className="text-green-600 shrink-0 mt-0.5"
                      size={20}
                    />
                  ) : (
                    <XCircle
                      className="text-red-600 shrink-0 mt-0.5"
                      size={20}
                    />
                  )}

                  <div className="text-sm min-w-0">
                    <p
                      className={`font-semibold ${
                        status ===
                        "face-verified"
                          ? "text-green-700"
                          : "text-red-700"
                      }`}
                    >
                      {status ===
                      "face-verified"
                        ? "ยืนยันใบหน้าสำเร็จ"
                        : "ใบหน้าไม่ตรงกับบัตรประชาชน"}
                    </p>

                    {faceResult && (
                      <div className="mt-1 space-y-0.5">
                        <p className="text-xs text-slate-500">
                          Confidence:{" "}
                          {faceResult.confidence.replace(
                            /_/g,
                            " "
                          )}
                        </p>

                        <p className="text-xs text-slate-500">
                          Similarity:{" "}
                          {faceResult.similarity.toFixed(
                            3
                          )}
                        </p>

                        <p className="text-xs text-slate-500">
                          Distance:{" "}
                          {faceResult.distance.toFixed(
                            3
                          )}
                        </p>
                      </div>
                    )}

                    {!faceResult && (
                      <p className="text-xs text-slate-500 mt-1">
                        {faceHint}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

          {/* Hidden canvases */}
          <canvas
            ref={canvasRef}
            className="hidden"
          />

          <canvas
            ref={ocrCanvasRef}
            className="hidden"
          />

          <canvas
            ref={selfieCanvasRef}
            className="hidden"
          />

          <canvas
            ref={brightnessCanvasRef}
            className="hidden"
          />
        </div>

        {/* Actions */}
        <div className="mt-6 space-y-3">

          {/* ID capture */}
          {status === "camera" && (
            <button
              onClick={
                handleManualCapture
              }
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-blue-200 text-blue-700 font-semibold hover:bg-blue-50 transition"
            >
              <Camera size={18} />
              ถ่ายภาพเอง
            </button>
          )}

          {/* Captured */}
          {status === "captured" && (
            <>
              <button
                onClick={
                  handleContinue
                }
                disabled={
                  idNumber.length !==
                  13
                }
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold transition"
              >
                <ScanFace
                  size={18}
                />

                ยืนยันใบหน้าต่อ
              </button>

              <button
                onClick={handleRetake}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition"
              >
                <RotateCcw
                  size={16}
                />

                ถ่ายบัตรใหม่
              </button>
            </>
          )}

          {/* Face verified */}
          {status ===
            "face-verified" && (
            <>
              <button
                onClick={
                  handleFinish
                }
                disabled={
                  submitting
                }
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold transition"
              >
                {submitting ? (
                  <Loader2
                    className="animate-spin"
                    size={18}
                  />
                ) : (
                  <ShieldCheck
                    size={18}
                  />
                )}

                {submitting
                  ? "กำลังลงทะเบียนสิทธิ์…"
                  : "ยืนยันและลงทะเบียนสิทธิ์โหวต"}
              </button>

              {submitError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />

                  <span>
                    {submitError}
                  </span>
                </div>
              )}

              <button
                onClick={
                  handleRetakeFace
                }
                disabled={
                  submitting
                }
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 disabled:opacity-50 transition"
              >
                <RotateCcw
                  size={16}
                />

                สแกนใบหน้าใหม่
              </button>
            </>
          )}

          {/* Face failed */}
          {status ===
            "face-failed" && (
            <>
              {submitError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />

                  <span>
                    {submitError}
                  </span>
                </div>
              )}

              <button
                onClick={
                  handleRetakeFace
                }
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition"
              >
                <RotateCcw
                  size={16}
                />

                ลองสแกนใบหน้าใหม่
              </button>

              <button
                onClick={() =>
                  setStatus(
                    "captured"
                  )
                }
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition"
              >
                กลับไปตรวจสอบบัตร
              </button>
            </>
          )}
        </div>

        {/* Camera error */}
        {cameraError &&
          status === "camera" && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0"
              />

              <span>
                {cameraError}
              </span>
            </div>
          )}

        {/* Privacy notice */}
        {(status === "camera" ||
          status === "captured" ||
          status === "face-scan" ||
          status ===
            "face-checking" ||
          status ===
            "face-verified" ||
          status ===
            "face-failed") && (
          <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
            <div className="flex items-start gap-2">
              <ShieldCheck
                className="text-blue-500 shrink-0 mt-0.5"
                size={16}
              />

              <p className="text-[11px] leading-5 text-slate-500">
                ระบบใช้ข้อมูลบัตรและใบหน้าเพื่อยืนยันตัวตนเท่านั้น
                โดยเลขบัตรจะถูกประมวลผลเป็นค่า Hash
                ก่อนบันทึก และระบบจะไม่บันทึก Wallet
                ลงในฐานข้อมูล Supabase
              </p>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}