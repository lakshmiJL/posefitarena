import { createFileRoute } from "@tanstack/react-router";
import { FitnessGame } from "@/components/FitnessGame";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "PoseFit Arena — Browser Pose Detection Fitness Game" },
      {
        name: "description",
        content:
          "Squat and jump in front of your webcam. Browser-based pose detection fitness game with streak bonuses and a 30-second challenge mode.",
      },
      { property: "og:title", content: "PoseFit Arena" },
      {
        property: "og:description",
        content: "Browser pose detection fitness game with streaks and challenge mode.",
      },
    ],
  }),
});

function Index() {
  return <FitnessGame />;
}
