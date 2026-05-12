import type { ExerciseId } from "./exerciseDetectors";

export interface RoutineStep {
  exercise: ExerciseId;
  reps: number;
}

export interface Routine {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  steps: RoutineStep[];
}

export const ROUTINES: Routine[] = [
  {
    id: "leg_day",
    name: "Leg Day",
    emoji: "🦵",
    tagline: "Quads, glutes & explosive power",
    steps: [
      { exercise: "squat", reps: 15 },
      { exercise: "lunge", reps: 12 },
      { exercise: "jump", reps: 10 },
      { exercise: "squat", reps: 15 },
      { exercise: "jumping_jack", reps: 20 },
    ],
  },
  {
    id: "shoulder_day",
    name: "Shoulder Day",
    emoji: "🏋️",
    tagline: "Boulder shoulders incoming",
    steps: [
      { exercise: "shoulder_press", reps: 12 },
      { exercise: "lateral_raise", reps: 12 },
      { exercise: "front_raise", reps: 12 },
      { exercise: "shoulder_press", reps: 10 },
      { exercise: "lateral_raise", reps: 10 },
    ],
  },
  {
    id: "arm_day",
    name: "Arm Day",
    emoji: "💪",
    tagline: "Sleeve-busting pump",
    steps: [
      { exercise: "bicep_curl", reps: 15 },
      { exercise: "shoulder_press", reps: 10 },
      { exercise: "pushup", reps: 10 },
      { exercise: "bicep_curl", reps: 12 },
      { exercise: "pushup", reps: 8 },
    ],
  },
  {
    id: "core_crusher",
    name: "Core Crusher",
    emoji: "🔥",
    tagline: "Abs of steel circuit",
    steps: [
      { exercise: "situp", reps: 15 },
      { exercise: "jumping_jack", reps: 20 },
      { exercise: "situp", reps: 12 },
      { exercise: "lunge", reps: 10 },
      { exercise: "situp", reps: 10 },
    ],
  },
  {
    id: "full_body",
    name: "Full Body Blast",
    emoji: "⚡",
    tagline: "Hit every muscle group",
    steps: [
      { exercise: "squat", reps: 12 },
      { exercise: "pushup", reps: 8 },
      { exercise: "shoulder_press", reps: 10 },
      { exercise: "lunge", reps: 10 },
      { exercise: "bicep_curl", reps: 12 },
      { exercise: "situp", reps: 12 },
      { exercise: "jumping_jack", reps: 20 },
    ],
  },
  {
    id: "hiit",
    name: "HIIT Cardio",
    emoji: "🚀",
    tagline: "Heart-pumping intervals",
    steps: [
      { exercise: "jumping_jack", reps: 25 },
      { exercise: "jump", reps: 12 },
      { exercise: "squat", reps: 15 },
      { exercise: "jumping_jack", reps: 20 },
      { exercise: "jump", reps: 10 },
    ],
  },
];

export function getRoutine(id: string): Routine | undefined {
  return ROUTINES.find((r) => r.id === id);
}
