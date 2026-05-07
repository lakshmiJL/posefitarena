import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePoseDetector } from "@/hooks/usePoseDetector";
import { EXERCISES, type ExerciseId } from "@/lib/exerciseDetectors";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Activity, Flame, Timer, Trophy, Zap, Camera, Target } from "lucide-react";

type Mode = "free" | "challenge";
const CHALLENGE_SECONDS = 30;

const MOTIVATION_GOOD = [
  "Let's go! 🔥",
  "Crushing it!",
  "You're on fire!",
  "Beast mode!",
  "Keep pushing!",
  "Unstoppable!",
];
const MOTIVATION_STREAK = [
  "STREAK x{n}! ⚡",
  "{n} in a row!",
  "Combo x{n}!",
  "Heat check x{n}!",
];

export function FitnessGame() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [mode, setMode] = useState<Mode>("free");
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [message, setMessage] = useState<string>(
    "Stand back so your full body is visible",
  );
  const [msgKey, setMsgKey] = useState(0);
  const [timeLeft, setTimeLeft] = useState(CHALLENGE_SECONDS);
  const [finished, setFinished] = useState(false);
  const [locked, setLocked] = useState<ExerciseId | null>(null);

  const lastRepTime = useRef<number>(0);

  const handleRep = useCallback(
    (type: ExerciseId) => {
      if (!running) return;
      const now = performance.now();
      const delta = now - lastRepTime.current;
      lastRepTime.current = now;

      let newStreak = 1;
      if (delta < 4000) {
        setStreak((s) => {
          newStreak = s + 1;
          return newStreak;
        });
      } else {
        setStreak(1);
        newStreak = 1;
      }

      const meta = EXERCISES.find((e) => e.id === type);
      const base = meta?.basePoints ?? 10;
      const bonus = Math.min(newStreak - 1, 9) * 3;
      setScore((s) => s + base + bonus);

      if (newStreak >= 3) {
        const tmpl =
          MOTIVATION_STREAK[Math.floor(Math.random() * MOTIVATION_STREAK.length)];
        setMessage(tmpl.replace("{n}", String(newStreak)));
      } else {
        const label = meta?.label ?? "Rep";
        const phrases = [
          `${label.slice(0, -1)}! 💥`,
          MOTIVATION_GOOD[Math.floor(Math.random() * MOTIVATION_GOOD.length)],
        ];
        setMessage(phrases[Math.floor(Math.random() * phrases.length)]);
      }
      setMsgKey((k) => k + 1);
      setBestStreak((b) => Math.max(b, newStreak));
    },
    [running],
  );

  const { ready, error, stats, reset } = usePoseDetector({
    videoRef,
    canvasRef,
    enabled: true,
    lockedExercise: locked,
    onRep: handleRep,
  });

  // Challenge timer
  useEffect(() => {
    if (!running || mode !== "challenge") return;
    if (timeLeft <= 0) {
      setRunning(false);
      setFinished(true);
      setMessage("Time's up! 🏁");
      setMsgKey((k) => k + 1);
      return;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [running, timeLeft, mode]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (performance.now() - lastRepTime.current > 5000 && streak > 0) {
        setStreak(0);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, streak]);

  const start = (m: Mode) => {
    setMode(m);
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setFinished(false);
    setTimeLeft(CHALLENGE_SECONDS);
    reset();
    lastRepTime.current = 0;
    setRunning(true);
    setMessage(m === "challenge" ? "GO! 30 seconds!" : "Free play — go wild!");
    setMsgKey((k) => k + 1);
  };

  const stop = () => {
    setRunning(false);
    setMessage("Paused");
    setMsgKey((k) => k + 1);
  };

  const total = useMemo(
    () => Object.values(stats.counts).reduce((a, b) => a + b, 0),
    [stats.counts],
  );
  const challengeProgress = useMemo(
    () => ((CHALLENGE_SECONDS - timeLeft) / CHALLENGE_SECONDS) * 100,
    [timeLeft],
  );
  const streakProgress = Math.min(streak * 10, 100);

  const lockedMeta = locked ? EXERCISES.find((e) => e.id === locked) : null;

  // Top performed exercises (sorted by count, show non-zero first then a few zero)
  const sortedExercises = useMemo(() => {
    return [...EXERCISES].sort(
      (a, b) => stats.counts[b.id] - stats.counts[a.id],
    );
  }, [stats.counts]);

  return (
    <div className="min-h-screen px-4 py-6 md:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            <h1 className="font-display text-4xl uppercase tracking-wider text-gradient-hero md:text-6xl">
              PoseFit Arena
            </h1>
          </div>
          <p className="text-sm text-muted-foreground md:text-base">
            10 exercises auto-detected from your webcam. Build streaks. Crush the clock.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* Camera panel */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-glow">
            <div className="relative aspect-[4/3] w-full bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 h-full w-full -scale-x-100"
              />

              {!ready && !error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 text-center">
                  <Camera className="h-10 w-10 animate-pulse-ring text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Loading camera & pose model…
                  </p>
                </div>
              )}
              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 px-6 text-center">
                  <p className="font-display text-2xl text-destructive">Camera blocked</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                  <p className="text-xs text-muted-foreground">
                    Allow camera access and reload.
                  </p>
                </div>
              )}

              {ready && (
                <div
                  key={msgKey}
                  className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 animate-pop-in rounded-full bg-card/80 px-5 py-2 font-display text-xl uppercase tracking-wider text-primary backdrop-blur-md shadow-glow"
                >
                  {message}
                </div>
              )}

              {lockedMeta && (
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-lg bg-card/80 px-3 py-2 backdrop-blur-md">
                  <Target className="h-4 w-4 text-primary" />
                  <span className="font-display text-sm uppercase tracking-wider text-primary">
                    {lockedMeta.emoji} {lockedMeta.label}
                  </span>
                </div>
              )}

              {mode === "challenge" && (running || finished) && (
                <div className="absolute right-4 top-4 flex items-center gap-2 rounded-lg bg-card/80 px-3 py-2 backdrop-blur-md">
                  <Timer className="h-4 w-4 text-accent" />
                  <span className="font-display text-2xl text-accent">{timeLeft}s</span>
                </div>
              )}
            </div>

            {mode === "challenge" && (
              <div className="px-4 py-3">
                <Progress value={challengeProgress} className="h-2" />
              </div>
            )}

            {/* Exercise picker */}
            <div className="border-t border-border p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Focus exercise (optional)
                </p>
                {locked && (
                  <button
                    onClick={() => setLocked(null)}
                    className="text-xs uppercase tracking-widest text-accent hover:underline"
                  >
                    Detect all
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {EXERCISES.map((e) => {
                  const active = locked === e.id;
                  return (
                    <button
                      key={e.id}
                      onClick={() => setLocked(active ? null : e.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                        active
                          ? "border-primary bg-primary text-primary-foreground shadow-glow"
                          : "border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground"
                      }`}
                      title={e.hint}
                    >
                      <span className="mr-1">{e.emoji}</span>
                      {e.label}
                    </button>
                  );
                })}
              </div>
              {lockedMeta && (
                <p className="mt-2 text-xs text-muted-foreground">
                  💡 {lockedMeta.hint}
                </p>
              )}
            </div>
          </div>

          {/* Stats panel */}
          <div className="flex flex-col gap-4">
            {/* Mode select */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
                Game Mode
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={mode === "free" ? "default" : "secondary"}
                  onClick={() => setMode("free")}
                  disabled={running}
                  className="font-display tracking-wider"
                >
                  Free Play
                </Button>
                <Button
                  variant={mode === "challenge" ? "default" : "secondary"}
                  onClick={() => setMode("challenge")}
                  disabled={running}
                  className="font-display tracking-wider"
                >
                  30s Challenge
                </Button>
              </div>
              <div className="mt-3 flex gap-2">
                {!running ? (
                  <Button
                    onClick={() => start(mode)}
                    disabled={!ready}
                    className="flex-1 bg-gradient-hero font-display text-lg uppercase tracking-widest text-primary-foreground hover:opacity-90"
                  >
                    {finished ? "Play Again" : "Start"}
                  </Button>
                ) : (
                  <Button
                    onClick={stop}
                    variant="destructive"
                    className="flex-1 font-display tracking-widest"
                  >
                    Stop
                  </Button>
                )}
              </div>
            </div>

            {/* Score */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                  <Trophy className="h-4 w-4 text-primary" /> Score
                </span>
                <span className="text-xs text-muted-foreground">
                  Best streak {bestStreak}
                </span>
              </div>
              <div className="mt-1 font-display text-6xl text-gradient-hero">
                {score}
              </div>
            </div>

            {/* Streak */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                  <Flame className="h-4 w-4 text-accent" /> Streak Bonus
                </span>
                <span className="font-display text-2xl text-accent">x{streak}</span>
              </div>
              <Progress value={streakProgress} className="h-3" />
              <p className="mt-2 text-xs text-muted-foreground">
                Chain reps within 4 seconds to multiply points.
              </p>
            </div>

            {/* All exercise reps */}
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
                Reps by exercise
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sortedExercises.map((e) => {
                  const count = stats.counts[e.id];
                  const pulse = stats.lastAction === e.id && running;
                  return (
                    <div
                      key={e.id + (pulse ? stats.actionTick : "")}
                      className={`flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2 ${
                        pulse ? "animate-pop-in border-primary" : ""
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{e.emoji}</span>
                        <span className="truncate">{e.label}</span>
                      </span>
                      <span
                        className={`font-display text-xl ${
                          count > 0 ? "text-foreground" : "text-muted-foreground/40"
                        }`}
                      >
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Total Reps
              </p>
              <p className="font-display text-4xl text-foreground">{total}</p>
            </div>
          </div>
        </div>

        <footer className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Zap className="h-3 w-3" /> 100% browser-based pose detection · TensorFlow.js
          MoveNet
        </footer>
      </div>
    </div>
  );
}
