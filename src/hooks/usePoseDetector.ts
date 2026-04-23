import { useEffect, useRef, useState, useCallback } from "react";
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import * as poseDetection from "@tensorflow-models/pose-detection";
import {
  EXERCISES,
  allExerciseIds,
  getDetector,
  makeState,
  type DetectorState,
  type ExerciseId,
} from "@/lib/exerciseDetectors";

export type { ExerciseId } from "@/lib/exerciseDetectors";

export interface PoseStats {
  counts: Record<ExerciseId, number>;
  lastAction: ExerciseId | null;
  actionTick: number;
}

interface Options {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  enabled: boolean;
  /** When set, only this exercise is detected. Otherwise all are. */
  lockedExercise?: ExerciseId | null;
  onRep?: (type: ExerciseId) => void;
}

const initCounts = (): Record<ExerciseId, number> =>
  Object.fromEntries(EXERCISES.map((e) => [e.id, 0])) as Record<ExerciseId, number>;

export function usePoseDetector({
  videoRef,
  canvasRef,
  enabled,
  lockedExercise,
  onRep,
}: Options) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PoseStats>({
    counts: initCounts(),
    lastAction: null,
    actionTick: 0,
  });

  const detectorRef = useRef<poseDetection.PoseDetector | null>(null);
  const rafRef = useRef<number | null>(null);
  const statesRef = useRef<Record<ExerciseId, DetectorState>>(
    Object.fromEntries(EXERCISES.map((e) => [e.id, makeState()])) as Record<
      ExerciseId,
      DetectorState
    >,
  );
  const lockedRef = useRef<ExerciseId | null>(lockedExercise ?? null);
  lockedRef.current = lockedExercise ?? null;
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

    const drawSkeleton = (
      kp: poseDetection.Keypoint[],
      ctx: CanvasRenderingContext2D,
    ) => {
      const get = (n: string) => kp.find((k) => k.name === n);
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
    };

    const analyze = (kp: poseDetection.Keypoint[]) => {
      const get = (n: string) => kp.find((k) => k.name === n);
      const now = performance.now();
      const ids: ExerciseId[] = lockedRef.current
        ? [lockedRef.current]
        : allExerciseIds();
      for (const id of ids) {
        const detector = getDetector(id);
        const state = statesRef.current[id];
        const fired = detector({ get, now, state });
        if (fired) {
          setStats((prev) => ({
            counts: { ...prev.counts, [id]: prev.counts[id] + 1 },
            lastAction: id,
            actionTick: prev.actionTick + 1,
          }));
          onRepRef.current?.(id);
        }
      }
    };

    const loop = async () => {
      if (stopped) return;
      const detector = detectorRef.current;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (detector && video && video.readyState >= 2 && canvas) {
        try {
          const poses = await detector.estimatePoses(video);
          const ctx = canvas.getContext("2d");
          if (ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (poses.length > 0) {
              drawSkeleton(poses[0].keypoints, ctx);
              analyze(poses[0].keypoints);
            }
          }
        } catch {
          /* ignore frame errors */
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [ready, enabled, videoRef, canvasRef]);

  const reset = useCallback(() => {
    setStats({ counts: initCounts(), lastAction: null, actionTick: 0 });
    statesRef.current = Object.fromEntries(
      EXERCISES.map((e) => [e.id, makeState()]),
    ) as Record<ExerciseId, DetectorState>;
  }, []);

  return { ready, error, stats, reset };
}
