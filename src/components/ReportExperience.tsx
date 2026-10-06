"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { generateDemoReport } from "@/lib/reportEngine";
import {
  getStoredIntake,
  getSubmittedIntakeContext,
  getStoredReportType,
  saveReport,
} from "@/lib/localStorage";
import { requestFreeQuickCheck } from "@/lib/freeQuickCheckClient";
import type { FreeQuickCheckResponse } from "@/lib/freeQuickCheck";
import type { DemoBuyerReport } from "@/types/domain";
import { ReportView } from "./ReportView";
import { ProgressSteps } from "./ProgressSteps";
import { FreeQuickCheckView } from "./FreeQuickCheckView";
export function ReportExperience() {
  const params = useSearchParams();
  const [report, setReport] = useState<DemoBuyerReport | null>(null);
  const [freeReport, setFreeReport] = useState<FreeQuickCheckResponse | null>(null);
  const [freeError, setFreeError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
      const type = params.get("type") ?? getStoredReportType();
    if (type === "free") {
      const context = getSubmittedIntakeContext();
      if (!context) { setFreeError("Your saved listing is unavailable in this browser."); setReady(true); return; }
      requestFreeQuickCheck({ listingId: context.listingId, submissionKey: context.submissionKey }).then(setFreeReport).catch((error: unknown) => setFreeError(error instanceof Error ? error.message : "Historical data is temporarily unavailable. Please try again.")).finally(() => setReady(true));
      return;
    }
    const intake = getStoredIntake();
    if (intake) {
      const generated = generateDemoReport(intake, "full");
      saveReport(generated);
      setReport(generated);
    }
    setReady(true);
  }, [params]);
  if (!ready) return <p role="status">Preparing your buyer report...</p>;
  if (freeReport) return <><ProgressSteps current={3} /><FreeQuickCheckView report={freeReport} onRetry={() => window.location.reload()} /></>;
  if (freeError) return <section className="empty-state"><h1>Free Quick Check unavailable</h1><p>{freeError}</p><button className="button button-primary" type="button" onClick={() => window.location.reload()}>Try again</button><Link className="text-link" href="/check">Check another car</Link></section>;
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
