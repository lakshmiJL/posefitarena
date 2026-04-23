import { useEffect, useRef, useState, useCallback } from "react";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import * as poseDetection from "@tensorflow-models/pose-detection";

export type ExerciseType = "squat" | "jump";

export interface PoseStats {
  squats: number;
  jumps: number;
  lastAction: ExerciseType | null;
  actionTick: number; // increments on each rep
}

interface Options {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  enabled: boolean;
  onRep?: (type: ExerciseType) => void;
}

/**
 * Browser-only pose detection using TensorFlow.js MoveNet.
 * Detects squats (hip-knee distance shrinks) and jumps (hip rises sharply).
 */
export function usePoseDetector({ videoRef, canvasRef, enabled, onRep }: Options) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PoseStats>({
    squats: 0,
    jumps: 0,
    lastAction: null,
    actionTick: 0,
  });

  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef({
    squatDown: false,
    inAir: false,
    baselineHipY: null as number | null,
    baselineKneeHipDist: null as number | null,
    lastJumpTime: 0,
    lastSquatTime: 0,
  });
  const onRepRef = useRef(onRep);
  onRepRef.current = onRep;

  // Init camera + model
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        if (!videoRef.current) return;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        await new Promise<void>((res) => {
          if (!videoRef.current) return res();
          videoRef.current.onloadedmetadata = () => res();
        });
        await videoRef.current.play();

        await tf.setBackend("webgl");
        await tf.ready();

        const detector = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING },
        );
        if (cancelled) {
          detector.dispose();
          return;
        }
        detectorRef.current = detector;
        setReady(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Camera/model failed";
        setError(msg);
      }
    }
    init();
    return () => {
      cancelled = true;
      const v = videoRef.current;
      if (v && v.srcObject) {
        (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      }
      detectorRef.current?.dispose();
      detectorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detection loop
  useEffect(() => {
    if (!ready || !enabled) return;
    let stopped = false;

    const loop = async () => {
      if (stopped) return;
      const detector = detectorRef.current;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (detector && video && video.readyState >= 2 && canvas) {
        try {
          const poses = await detector.estimatePoses(video);
          drawAndAnalyze(poses, canvas, video);
        } catch {
          /* ignore frame errors */
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    const drawAndAnalyze = (
      poses: poseDetection.Pose[],
      canvas: HTMLCanvasElement,
      video: HTMLVideoElement,
    ) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (poses.length === 0) return;
      const kp = poses[0].keypoints;
      const get = (name: string) => kp.find((k) => k.name === name);

      // Draw skeleton
      ctx.fillStyle = "oklch(0.82 0.22 140)";
      ctx.strokeStyle = "oklch(0.82 0.22 140 / 0.7)";
      ctx.lineWidth = 3;
      for (const k of kp) {
        if ((k.score ?? 0) > 0.4) {
          ctx.beginPath();
          ctx.arc(k.x, k.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const pairs: [string, string][] = [
        ["left_shoulder", "right_shoulder"],
        ["left_shoulder", "left_hip"],
        ["right_shoulder", "right_hip"],
        ["left_hip", "right_hip"],
        ["left_hip", "left_knee"],
        ["left_knee", "left_ankle"],
        ["right_hip", "right_knee"],
        ["right_knee", "right_ankle"],
        ["left_shoulder", "left_elbow"],
        ["left_elbow", "left_wrist"],
        ["right_shoulder", "right_elbow"],
        ["right_elbow", "right_wrist"],
      ];
      for (const [a, b] of pairs) {
        const ka = get(a);
        const kb = get(b);
        if (ka && kb && (ka.score ?? 0) > 0.4 && (kb.score ?? 0) > 0.4) {
          ctx.beginPath();
          ctx.moveTo(ka.x, ka.y);
          ctx.lineTo(kb.x, kb.y);
          ctx.stroke();
        }
      }

      // Analyze: use mid-hip and mid-knee
      const lh = get("left_hip");
      const rh = get("right_hip");
      const lk = get("left_knee");
      const rk = get("right_knee");
      if (
        !lh ||
        !rh ||
        !lk ||
        !rk ||
        (lh.score ?? 0) < 0.4 ||
        (rh.score ?? 0) < 0.4 ||
        (lk.score ?? 0) < 0.4 ||
        (rk.score ?? 0) < 0.4
      )
        return;

      const hipY = (lh.y + rh.y) / 2;
      const kneeY = (lk.y + rk.y) / 2;
      const dist = Math.abs(kneeY - hipY);
      const s = stateRef.current;
      const now = performance.now();

      // Calibrate baseline (running average when standing)
      if (s.baselineHipY === null) s.baselineHipY = hipY;
      if (s.baselineKneeHipDist === null) s.baselineKneeHipDist = dist;
      // Slow drift toward standing baseline
      if (!s.squatDown && !s.inAir) {
        s.baselineHipY = s.baselineHipY * 0.95 + hipY * 0.05;
        s.baselineKneeHipDist = s.baselineKneeHipDist * 0.95 + dist * 0.05;
      }

      // JUMP: hip rises significantly above baseline
      const jumpThreshold = 40; // px upward (y decreases)
      if (
        !s.inAir &&
        s.baselineHipY - hipY > jumpThreshold &&
        now - s.lastJumpTime > 400
      ) {
        s.inAir = true;
      } else if (s.inAir && s.baselineHipY - hipY < 10) {
        s.inAir = false;
        s.lastJumpTime = now;
        setStats((p) => ({
          ...p,
          jumps: p.jumps + 1,
          lastAction: "jump",
          actionTick: p.actionTick + 1,
        }));
        onRepRef.current?.("jump");
      }

      // SQUAT: knee-hip vertical distance shrinks (legs bent)
      const squatRatio = dist / (s.baselineKneeHipDist || 1);
      if (!s.squatDown && !s.inAir && squatRatio < 0.65 && now - s.lastSquatTime > 400) {
        s.squatDown = true;
      } else if (s.squatDown && squatRatio > 0.85) {
        s.squatDown = false;
        s.lastSquatTime = now;
        setStats((p) => ({
          ...p,
          squats: p.squats + 1,
          lastAction: "squat",
          actionTick: p.actionTick + 1,
        }));
        onRepRef.current?.("squat");
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [ready, enabled, videoRef, canvasRef]);

  const reset = useCallback(() => {
    setStats({ squats: 0, jumps: 0, lastAction: null, actionTick: 0 });
    stateRef.current.baselineHipY = null;
    stateRef.current.baselineKneeHipDist = null;
    stateRef.current.squatDown = false;
    stateRef.current.inAir = false;
  }, []);

  return { ready, error, stats, reset };
}