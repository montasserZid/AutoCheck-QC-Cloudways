"use client";

import Link from "next/link";
import type { FreeQuickCheckResponse } from "@/lib/freeQuickCheck";

export function FreeQuickCheckView({ report, onRetry }: { report: FreeQuickCheckResponse; onRetry: () => void }) {
  const title = [report.vehicle.year, report.vehicle.make, report.vehicle.model, report.vehicle.trim].filter(Boolean).join(" ");
  return (
    <article className="report-shell">
      <header className="report-banner">
        <div>
          <p className="eyebrow">Free Quick Check</p>
          <h1>{title}</h1>
          <p>Historical model-year information, not a condition assessment of this listed vehicle.</p>
        </div>
        <div className="risk-summary unknown"><span>HISTORICAL SIGNAL</span><strong>—</strong><small>Not yet scored</small></div>
      </header>
      <section className="report-section">
        <div className="report-section-heading"><span>01</span><h2>Available historical data</h2></div>
        <p>{report.coverage.label}</p>
        {report.coverage.status === "matched" && report.topHistoricalAreas.length > 0 && (
          <div className="finding-list">
            {report.topHistoricalAreas.map((area, index) => (
              <div className="finding-item" key={area.name}>
                <span className="finding-index">{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{area.name}</h3><p>{area.historicalComplaintCount.toLocaleString("en-CA")} aggregate historical complaints in this category.</p></div>
              </div>
            ))}
          </div>
        )}
        {report.headlines.map((headline) => <p key={headline}>{headline}</p>)}
      </section>
      <section className="report-section">
        <div className="report-section-heading"><span>02</span><h2>What this means</h2></div>
        <p>Historical patterns can help prioritize what to investigate. They do not establish the condition of this vehicle or replace a professional mechanical inspection.</p>
        {report.lockedSummary?.additionalHistoricalDetailAvailable && <p className="fine-print">Additional historical detail is available in a future full report.</p>}
      </section>
      <section className="report-section">
        <div className="button-row">
          <button className="button button-secondary" type="button" onClick={onRetry}>Try again</button>
          <Link className="button button-primary" href="/inspection">Book a Mobile Inspection</Link>
        </div>
      </section>
    </article>
  );
}
