"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createWorker, type Worker } from "tesseract.js";
import { extractValidCitizenId } from "@/lib/thai-id";
import { isVoterRegistered } from "@/lib/solana-program";
import {
  verifyFace,
  detectLandmarks,
  loadFaceModels,
  type FaceMatchResult,
} from "@/lib/face-match";
import {
  computeMetrics,
  mirrorPositions,
  shuffleChallenges,
  averageBrightness,
  CHALLENGE_LABELS,
  YAW_THRESHOLD,
  PITCH_THRESHOLD,
  EAR_BLINK_THRESHOLD,
  EAR_OPEN_THRESHOLD,
  STRAIGHT_YAW_TOLERANCE,
  STRAIGHT_PITCH_TOLERANCE,
  BRIGHTNESS_MIN,
  BRIGHTNESS_MAX,
  type LivenessChallenge,
} from "@/lib/liveness";
import {
  Camera,
  RotateCcw,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ScanFace,
  AlertCircle,
  Loader2,
} from "lucide-react";

type ScanStatus =
  | "checking-wallet"
  | "camera"
  | "captured"
  | "loading-face-models"
  | "face-scan"
  | "face-checking"
  | "face-verified"
  | "face-failed";

export default function VerifyPage() {
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ocrCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);

  // Selfie / face-verification step
  const selfieVideoRef = useRef<HTMLVideoElement>(null);
  const selfieCanvasRef = useRef<HTMLCanvasElement>(null);
  const brightnessCanvasRef = useRef<HTMLCanvasElement>(null);
  const selfieStreamRef = useRef<MediaStream | null>(null);
  const faceScanTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const faceBusyRef = useRef(false);

  // Liveness challenge sequence
  const baselineRef = useRef<{ yaw: number; pitch: number } | null>(null);
  const calibSamplesRef = useRef<{ yaw: number; pitch: number }[]>([]);
  const challengeOrderRef = useRef<LivenessChallenge[]>([]);
  const holdCounterRef = useRef(0);
  const blinkWasClosedRef = useRef(false);

  const [status, setStatus] = useState<ScanStatus>("checking-wallet");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [idNumber, setIdNumber] = useState<string>("");
  const [scanHint, setScanHint] = useState("กำลังเปิดกล้อง…");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [faceHint, setFaceHint] = useState("กำลังเตรียมกล้องหน้า…");
  const [faceResult, setFaceResult] = useState<FaceMatchResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [livenessPhase, setLivenessPhase] = useState<
    "calibrating" | LivenessChallenge | "passed"
  >("calibrating");
  const [completedChallenges, setCompletedChallenges] = useState<
    LivenessChallenge[]
  >([]);

  // --- Guard: this page is only reachable after Phantom is connected.
  // Tries a *silent* reconnect (onlyIfTrusted) first, so landing here
  // directly (e.g. a bookmark) after closing and reopening the browser
  // still works without re-clicking "Connect Phantom" — Phantom
  // remembers previously-approved sites. If the wallet turns out to
  // already be verified (has a Voter account on-chain), skip straight
  // to /vote instead of asking them to verify again. ---
  useEffect(() => {
    let cancelled = false;

    async function checkWalletAndVerification() {
      const provider =
        typeof window !== "undefined" ? (window as any).solana : null;

      if (!provider?.isPhantom) {
        if (!cancelled) router.replace("/");
        return;
      }

      let address: string;
      try {
        const response = await provider.connect({ onlyIfTrusted: true });
        address = response.publicKey.toString();
      } catch {
        if (!cancelled) router.replace("/");
        return;
      }

      if (cancelled) return;

      try {
        const registered = await isVoterRegistered(address);
        if (cancelled) return;

        if (registered) {
          router.replace("/vote");
          return;
        }
      } catch (err) {
        console.error("Failed to check voter registration:", err);
        // Chain check failing shouldn't block a legitimate attempt to
        // verify — fall through and let them proceed normally.
      }

      setWalletAddress(address);
      setStatus("camera");
    }

    checkWalletAndVerification();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // --- Start the camera once we're past the wallet check ---
  useEffect(() => {
    if (status !== "camera") return;

    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setScanHint("วางบัตรประชาชนให้อยู่ในกรอบ");
      } catch (err) {
        console.error(err);
        setCameraError(
          "ไม่สามารถเข้าถึงกล้องได้ กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์"
        );
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [status]);

  // --- OCR worker lifecycle (loaded once, reused across scan attempts) ---
  useEffect(() => {
    let cancelled = false;

    async function initWorker() {
      const worker = await createWorker("eng");
      if (cancelled) {
        worker.terminate();
        return;
      }
      workerRef.current = worker;
    }

    initWorker();

    return () => {
      cancelled = true;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.filter = "none";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  }, []);

  // Grayscale + slight blur before OCR — the browser-canvas equivalent
  // of ocr.py's cv2.cvtColor(..., COLOR_BGR2GRAY) + GaussianBlur step.
  // Run on a separate canvas so the color image we keep as the ID photo
  // record is untouched; this version is only fed to Tesseract.
  const captureFrameForOcr = useCallback((): string | null => {
    const video = videoRef.current;
    const ocrCanvas = ocrCanvasRef.current;
    if (!video || !ocrCanvas || video.videoWidth === 0) return null;

    ocrCanvas.width = video.videoWidth;
    ocrCanvas.height = video.videoHeight;
    const ctx = ocrCanvas.getContext("2d");
    if (!ctx) return null;

    ctx.filter = "grayscale(1) blur(0.6px) contrast(1.15)";
    ctx.drawImage(video, 0, 0, ocrCanvas.width, ocrCanvas.height);
    return ocrCanvas.toDataURL("image/jpeg", 0.92);
  }, []);

  const finishCapture = useCallback((dataUrl: string, detectedId: string) => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);

    setCapturedImage(dataUrl);
    setIdNumber(detectedId);
    setStatus("captured");
  }, []);

  // --- Auto-scan loop: sample frames every ~1.4s, run OCR on a
  // grayscale+blurred copy, and trust the first checksum-valid 13-digit
  // ID we find (a passing checksum is a much stronger signal than just
  // "read the same wrong number twice", so no repeat-read wait needed). ---
  useEffect(() => {
    if (status !== "camera") return;

    scanTimerRef.current = setInterval(async () => {
      if (busyRef.current || !workerRef.current) return;

      const ocrFrame = captureFrameForOcr();
      if (!ocrFrame) return;

      busyRef.current = true;
      try {
        const {
          data: { text },
        } = await workerRef.current.recognize(ocrFrame);

        const found = extractValidCitizenId(text);

        if (found) {
          setScanHint(`ตรวจพบเลขบัตรที่ถูกต้อง: ${found}`);
          const fullFrame = captureFrame();
          if (fullFrame) {
            finishCapture(fullFrame, found);
          }
        } else {
          setScanHint("วางบัตรประชาชนให้อยู่ในกรอบ ให้แสงเพียงพอ");
        }
      } catch (err) {
        console.error(err);
      } finally {
        busyRef.current = false;
      }
    }, 1400);

    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, [status, captureFrame, captureFrameForOcr, finishCapture]);

  function handleManualCapture() {
    const dataUrl = captureFrame();
    if (!dataUrl) return;
    finishCapture(dataUrl, idNumber);
  }

  function handleRetake() {
    setCapturedImage(null);
    setIdNumber("");
    setStatus("camera");
  }

  function handleContinue() {
    setStatus("loading-face-models");
  }

  // --- Preload face-api models as soon as we enter that step ---
  useEffect(() => {
    if (status !== "loading-face-models") return;

    let cancelled = false;

    loadFaceModels()
      .then(() => {
        if (!cancelled) {
          calibSamplesRef.current = [];
          baselineRef.current = null;
          challengeOrderRef.current = [];
          holdCounterRef.current = 0;
          blinkWasClosedRef.current = false;
          setCompletedChallenges([]);
          setLivenessPhase("calibrating");
          setStatus("face-scan");
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setFaceHint("โหลดโมเดลตรวจจับใบหน้าไม่สำเร็จ ลองรีเฟรชหน้านี้");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  // --- Start the front-facing camera for the selfie step ---
  useEffect(() => {
    if (status !== "face-scan") return;

    let cancelled = false;

    async function startSelfieCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        selfieStreamRef.current = stream;
        if (selfieVideoRef.current) {
          selfieVideoRef.current.srcObject = stream;
          await selfieVideoRef.current.play();
        }
        setFaceHint("จัดใบหน้าให้อยู่ในกรอบวงรี");
      } catch (err) {
        console.error(err);
        setFaceHint("ไม่สามารถเข้าถึงกล้องหน้าได้ กรุณาอนุญาตการใช้กล้อง");
      }
    }

    startSelfieCamera();

    return () => {
      cancelled = true;
      selfieStreamRef.current?.getTracks().forEach((t) => t.stop());
      selfieStreamRef.current = null;
    };
  }, [status]);

  const captureSelfieFrame = useCallback((): string | null => {
    const video = selfieVideoRef.current;
    const canvas = selfieCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  }, []);

  const runFaceMatch = useCallback(
    async (selfieDataUrl: string) => {
      if (!capturedImage) return;

      setStatus("face-checking");
      selfieStreamRef.current?.getTracks().forEach((t) => t.stop());
      selfieStreamRef.current = null;
      if (faceScanTimerRef.current) clearInterval(faceScanTimerRef.current);

      try {
        const result = await verifyFace(capturedImage, selfieDataUrl);
        setFaceResult(result);
        setStatus(result.verified ? "face-verified" : "face-failed");
      } catch (err) {
        console.error(err);
        setFaceResult(null);
        setFaceHint(
          err instanceof Error ? err.message : "ตรวจสอบใบหน้าไม่สำเร็จ"
        );
        setStatus("face-failed");
      }
    },
    [capturedImage]
  );

  function resetLivenessProgress(hint: string) {
    calibSamplesRef.current = [];
    baselineRef.current = null;
    challengeOrderRef.current = [];
    holdCounterRef.current = 0;
    blinkWasClosedRef.current = false;
    setCompletedChallenges([]);
    setLivenessPhase("calibrating");
    setFaceHint(hint);
  }

  // --- Liveness challenge engine. Runs continuously while status is
  // "face-scan": checks lighting, then either calibrates a per-session
  // baseline (yaw/pitch/EAR while facing forward), works through a
  // shuffled turn/nod/blink sequence, or — once all challenges pass —
  // waits for the face to return to a centered, forward-facing
  // position before capturing and handing off to the ID-vs-selfie
  // match. Losing the face entirely at any point resets the whole
  // sequence back to calibration. ---
  useEffect(() => {
    if (status !== "face-scan") return;

    faceScanTimerRef.current = setInterval(async () => {
      if (faceBusyRef.current) return;
      const video = selfieVideoRef.current;
      const brightnessCanvas = brightnessCanvasRef.current;
      if (!video || !brightnessCanvas || video.videoWidth === 0) return;

      faceBusyRef.current = true;
      try {
        // --- Lighting check first: too dark/bright makes every other
        // measurement unreliable, so just pause (don't reset progress,
        // don't advance) until it's back in range. ---
        brightnessCanvas.width = 64;
        brightnessCanvas.height = 64;
        const bctx = brightnessCanvas.getContext("2d");
        if (bctx) {
          bctx.drawImage(video, 0, 0, 64, 64);
          const brightness = averageBrightness(
            bctx.getImageData(0, 0, 64, 64)
          );

          if (brightness < BRIGHTNESS_MIN) {
            setFaceHint("แสงน้อยเกินไป กรุณาไปที่ที่มีแสงสว่างมากขึ้น");
            return;
          }
          if (brightness > BRIGHTNESS_MAX) {
            setFaceHint("แสงสว่างเกินไป กรุณาหลีกเลี่ยงแสงจ้าหรือแสงย้อน");
            return;
          }
        }

        const rawPositions = await detectLandmarks(video);

        if (!rawPositions) {
          // Face left the frame — restart the whole sequence rather
          // than letting partial progress carry over from a possibly
          // different face/position.
          if (
            livenessPhase !== "calibrating" ||
            calibSamplesRef.current.length > 0
          ) {
            resetLivenessProgress("ไม่พบใบหน้า เริ่มการตรวจสอบใหม่อีกครั้ง");
          } else {
            setFaceHint("ไม่พบใบหน้า กรุณาจัดใบหน้าให้อยู่ในกรอบ");
          }
          return;
        }

        const positions = mirrorPositions(rawPositions, video.videoWidth);
        const metrics = computeMetrics(positions);

        if (livenessPhase === "calibrating") {
          calibSamplesRef.current.push({
            yaw: metrics.yaw,
            pitch: metrics.pitch,
          });
          setFaceHint("อยู่นิ่งๆ มองตรงกล้อง กำลังปรับเทียบ…");

          if (calibSamplesRef.current.length >= 5) {
            const n = calibSamplesRef.current.length;
            const avgYaw =
              calibSamplesRef.current.reduce((s, m) => s + m.yaw, 0) / n;
            const avgPitch =
              calibSamplesRef.current.reduce((s, m) => s + m.pitch, 0) / n;
            baselineRef.current = { yaw: avgYaw, pitch: avgPitch };

            challengeOrderRef.current = shuffleChallenges([
              "turn-left",
              "turn-right",
              "nod-up",
              "nod-down",
              "blink",
            ]);

            const first = challengeOrderRef.current[0];
            setLivenessPhase(first);
            setFaceHint(CHALLENGE_LABELS[first]);
          }
          return;
        }

        const baseline = baselineRef.current;
        if (!baseline) return;

        // --- All challenges done: wait for the face to come back to
        // roughly the calibrated center before capturing, instead of
        // just grabbing whatever frame happens to be there. ---
        if (livenessPhase === "passed") {
          const centered =
            Math.abs(metrics.yaw - baseline.yaw) < STRAIGHT_YAW_TOLERANCE &&
            Math.abs(metrics.pitch - baseline.pitch) <
              STRAIGHT_PITCH_TOLERANCE;

          if (centered) {
            holdCounterRef.current += 1;
            setFaceHint("มองตรงกล้อง นิ่งๆ กำลังถ่ายภาพ…");
          } else {
            holdCounterRef.current = 0;
            setFaceHint("มองตรงกล้องให้หน้าอยู่กึ่งกลางเพื่อถ่ายภาพ");
          }

          if (holdCounterRef.current >= 2) {
            const shot = captureSelfieFrame();
            if (shot) {
              setSelfieImage(shot);
              await runFaceMatch(shot);
            }
          }
          return;
        }

        const currentChallenge = livenessPhase;
        let satisfied = false;

        switch (currentChallenge) {
          case "turn-left":
            satisfied = metrics.yaw < baseline.yaw - YAW_THRESHOLD;
            break;
          case "turn-right":
            satisfied = metrics.yaw > baseline.yaw + YAW_THRESHOLD;
            break;
          case "nod-up":
            satisfied = metrics.pitch < baseline.pitch - PITCH_THRESHOLD;
            break;
          case "nod-down":
            satisfied = metrics.pitch > baseline.pitch + PITCH_THRESHOLD;
            break;
          case "blink":
            if (metrics.ear < EAR_BLINK_THRESHOLD) {
              blinkWasClosedRef.current = true;
            } else if (
              blinkWasClosedRef.current &&
              metrics.ear > EAR_OPEN_THRESHOLD
            ) {
              satisfied = true;
            }
            break;
        }

        if (satisfied) {
          holdCounterRef.current += 1;
        } else if (currentChallenge !== "blink") {
          holdCounterRef.current = 0;
        }

        const requiredHold = currentChallenge === "blink" ? 1 : 2;

        if (holdCounterRef.current >= requiredHold) {
          holdCounterRef.current = 0;
          blinkWasClosedRef.current = false;

          setCompletedChallenges((prev) => [...prev, currentChallenge]);

          const idx = challengeOrderRef.current.indexOf(currentChallenge);
          const next = challengeOrderRef.current[idx + 1];

          if (next) {
            setLivenessPhase(next);
            setFaceHint(CHALLENGE_LABELS[next]);
          } else {
            setLivenessPhase("passed");
            setFaceHint("ผ่านการตรวจสอบครบแล้ว มองตรงกล้องเพื่อถ่ายภาพ");
          }
        } else {
          setFaceHint(CHALLENGE_LABELS[currentChallenge]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        faceBusyRef.current = false;
      }
    }, 350);

    return () => {
      if (faceScanTimerRef.current) clearInterval(faceScanTimerRef.current);
    };
  }, [status, livenessPhase, captureSelfieFrame, runFaceMatch]);

  function handleRetakeFace() {
    resetLivenessProgress("จัดใบหน้าให้อยู่ในกรอบวงรี");
    setSelfieImage(null);
    setFaceResult(null);
    setStatus("face-scan");
  }

  async function handleFinish() {
    if (!walletAddress || !idNumber || !faceResult) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/verify-voter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          idNumber,
          faceSimilarity: faceResult.similarity,
          faceConfidence: faceResult.confidence,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error || "เกิดข้อผิดพลาด กรุณาลองใหม่");
        setSubmitting(false);
        return;
      }

      router.push("/vote");
    } catch (err) {
      console.error(err);
      setSubmitError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่");
      setSubmitting(false);
    }
  }

  if (status === "checking-wallet") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-500 text-sm">
          กำลังตรวจสอบการเชื่อมต่อกระเป๋าเงิน…
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-blue-100 p-6 sm:p-8">
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
            <ShieldCheck className="text-blue-600" size={30} />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center text-slate-800">
          สแกนบัตรประชาชน
        </h1>
        <p className="text-center text-slate-500 mt-2 text-sm">
          วางบัตรประชาชนให้อยู่ในกรอบ ระบบจะถ่ายภาพให้อัตโนมัติ
        </p>

        <div className="mt-6">
          {status === "camera" && (
            <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-900">
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover"
              />

              {/* Guide frame — ID-1 card ratio, ~1.586:1 */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-[82%] aspect-[1.586/1]">
                  <div className="absolute inset-0 rounded-xl border-2 border-white/70" />
                  <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />
                  <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />
                  <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />
                </div>
              </div>

              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                <p className="text-white text-xs text-center font-medium">
                  {cameraError ?? scanHint}
                </p>
              </div>
            </div>
          )}

          {status === "captured" && capturedImage && (
            <div>
              <div className="relative w-full aspect-[1.586/1] rounded-2xl overflow-hidden border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={capturedImage}
                  alt="Captured ID card"
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                <CheckCircle2 className="text-green-600 shrink-0" size={18} />
                <div className="text-sm">
                  <p className="font-semibold text-green-700">ถ่ายภาพสำเร็จ</p>
                  <p className="text-slate-600 font-mono text-xs mt-0.5">
                    {idNumber || "ไม่พบเลขบัตร — กรุณากรอกด้วยตนเอง"}
                  </p>
                </div>
              </div>

              {!idNumber && (
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="กรอกเลขบัตรประชาชน 13 หลัก"
                  maxLength={13}
                  value={idNumber}
                  onChange={(e) =>
                    setIdNumber(e.target.value.replace(/\D/g, ""))
                  }
                  className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              )}
            </div>
          )}

          {status === "loading-face-models" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 className="animate-spin text-blue-500" size={28} />
              <p className="text-sm text-slate-500">
                กำลังโหลดโมเดลตรวจจับใบหน้า…
              </p>
            </div>
          )}

          {(status === "face-scan" || status === "face-checking") && (
            <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-900">
              <video
                ref={selfieVideoRef}
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover -scale-x-100"
              />

              {/* Face oval guide */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[60%] aspect-[3/4] rounded-[50%] border-2 border-white/70" />
              </div>

              {/* Liveness challenge progress dots */}
              {status === "face-scan" &&
                livenessPhase !== "calibrating" &&
                challengeOrderRef.current.length > 0 && (
                  <div className="absolute top-3 inset-x-0 flex justify-center gap-2">
                    {challengeOrderRef.current.map((c) => (
                      <div
                        key={c}
                        className={`h-2 w-2 rounded-full transition-colors ${
                          completedChallenges.includes(c)
                            ? "bg-green-400"
                            : c === livenessPhase
                              ? "bg-blue-400"
                              : "bg-white/40"
                        }`}
                      />
                    ))}
                  </div>
                )}

              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                <p className="text-white text-xs text-center font-medium flex items-center justify-center gap-1.5">
                  {status === "face-checking" && (
                    <Loader2 className="animate-spin" size={14} />
                  )}
                  {status === "face-checking"
                    ? "กำลังเปรียบเทียบใบหน้ากับบัตร…"
                    : faceHint}
                </p>
              </div>
            </div>
          )}

          {(status === "face-verified" || status === "face-failed") &&
            selfieImage && (
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative aspect-[1.586/1] rounded-xl overflow-hidden border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={capturedImage ?? undefined}
                      alt="ID card"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="relative aspect-[1.586/1] rounded-xl overflow-hidden border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selfieImage}
                      alt="Selfie"
                      className="h-full w-full object-cover -scale-x-100"
                    />
                  </div>
                </div>

                <div
                  className={`mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 ${
                    status === "face-verified"
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  }`}
                >
                  {status === "face-verified" ? (
                    <CheckCircle2
                      className="text-green-600 shrink-0"
                      size={18}
                    />
                  ) : (
                    <XCircle className="text-red-600 shrink-0" size={18} />
                  )}
                  <div className="text-sm">
                    <p
                      className={`font-semibold ${
                        status === "face-verified"
                          ? "text-green-700"
                          : "text-red-700"
                      }`}
                    >
                      {status === "face-verified"
                        ? "ใบหน้าตรงกับบัตรประชาชน"
                        : "ใบหน้าไม่ตรงกับบัตรประชาชน"}
                    </p>
                    {faceResult && (
                      <p className="text-slate-500 text-xs mt-0.5">
                        ความเชื่อมั่น: {faceResult.confidence.replace("_", " ")}{" "}
                        (similarity {faceResult.similarity})
                      </p>
                    )}
                    {!faceResult && (
                      <p className="text-slate-500 text-xs mt-0.5">
                        {faceHint}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

          <canvas ref={canvasRef} className="hidden" />
          <canvas ref={ocrCanvasRef} className="hidden" />
          <canvas ref={selfieCanvasRef} className="hidden" />
          <canvas ref={brightnessCanvasRef} className="hidden" />
        </div>

        <div className="mt-6 space-y-3">
          {status === "camera" && (
            <button
              onClick={handleManualCapture}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-blue-200 text-blue-700 font-semibold hover:bg-blue-50 transition"
            >
              <Camera size={18} />
              ถ่ายภาพเอง
            </button>
          )}

          {status === "captured" && (
            <>
              <button
                onClick={handleContinue}
                disabled={idNumber.length !== 13}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold transition"
              >
                <ScanFace size={18} />
                ยืนยันใบหน้าต่อ
              </button>
              <button
                onClick={handleRetake}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition"
              >
                <RotateCcw size={16} />
                ถ่ายใหม่
              </button>
            </>
          )}

          {status === "face-verified" && (
            <>
              <button
                onClick={handleFinish}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold transition"
              >
                {submitting && <Loader2 className="animate-spin" size={18} />}
                {submitting ? "กำลังลงทะเบียน…" : "เสร็จสิ้น ลงทะเบียนสิทธิ์โหวต"}
              </button>
              {submitError && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}
            </>
          )}

          {status === "face-failed" && (
            <button
              onClick={handleRetakeFace}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition"
            >
              <RotateCcw size={16} />
              ลองสแกนใบหน้าใหม่
            </button>
          )}
        </div>

        {cameraError && status === "camera" && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{cameraError}</span>
          </div>
        )}
      </div>
    </main>
  );
}