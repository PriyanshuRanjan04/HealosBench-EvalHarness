import type { Metadata } from "next";
import RunsDashboard from "./dashboard";

export const metadata: Metadata = {
  title: "Eval Runs — HealosBench",
  description: "HealosBench evaluation run history and comparison",
};

export default function DashboardPage() {
  return <RunsDashboard />;
}
