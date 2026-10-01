"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { generateDemoReport } from "@/lib/reportEngine";
import {
  getStoredIntake,
  getStoredReportType,
  saveReport,
} from "@/lib/localStorage";
import type { DemoBuyerReport } from "@/types/domain";
import { ReportView } from "./ReportView";
import { ProgressSteps } from "./ProgressSteps";
export function ReportExperience() {
  const params = useSearchParams();
  const [report, setReport] = useState<DemoBuyerReport | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const intake = getStoredIntake();
    if (intake) {
      const type = params.get("type") ?? getStoredReportType();
      const generated = generateDemoReport(
        intake,
        type === "free" ? "free" : "full",
      );
      saveReport(generated);
      setReport(generated);
    }
    setReady(true);
  }, [params]);
  if (!ready) return <p role="status">Preparing your buyer report...</p>;
  if (!report)
    return (
      <section className="empty-state">
        <h1>Add a listing to see your report.</h1>
        <p>Your vehicle details are not available in this browser.</p>
        <Link className="button button-primary" href="/check">
          Check This Car
        </Link>
        <Link className="text-link" href="/example-report">
          See an Example Report
        </Link>
      </section>
    );
  return (
    <>
      <ProgressSteps current={3} />
      <ReportView report={report} />
    </>
  );
}
