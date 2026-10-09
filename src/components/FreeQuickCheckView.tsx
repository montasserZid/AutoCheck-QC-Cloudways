"use client";

import Link from "next/link";
import type { FreeQuickCheckResponse } from "@/lib/freeQuickCheck";
import type { VehicleIntake } from "@/types/domain";
import { VehicleIdentityPlate } from "./dossier/VehicleIdentityPlate";

export function FreeQuickCheckView({
  report,
  onRetry,
  vehicle,
}: {
  report: FreeQuickCheckResponse;
  onRetry: () => void;
  vehicle?: VehicleIntake;
}) {
  const title = [
    report.vehicle.year,
    report.vehicle.make,
    report.vehicle.model,
    report.vehicle.trim,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <article className="report-shell free-report">
      <div className="report-toolbar"><span>AUTOCHECK / QC — FREE DOSSIER</span><Link className="text-link" href="/check?step=choose">Report options</Link></div>
      <VehicleIdentityPlate vehicle={vehicle ?? { ...report.vehicle, trim: report.vehicle.trim ?? "" }} compact stateLabel="MODEL HISTORY · NOT VEHICLE CONDITION" />
      <header className="report-banner">
        <div>
          <p className="eyebrow">Free Quick Check</p>
          <h1>Start with what the history can tell you.</h1>
          <p>
            {title}. Historical model-year information, not a condition assessment of this listed vehicle.
          </p>
        </div>
        <div className="risk-summary unknown">
          <span>DATA COVERAGE</span>
          <strong>
            {report.coverage.status === "matched" ? "Matched" : "Limited"}
          </strong>
          <small>Not a vehicle condition score</small>
        </div>
      </header>
      <section className="report-section">
        <div className="report-section-heading">
          <span>01</span>
          <h2>Available historical data</h2>
        </div>
        <p>{report.coverage.label}</p>
        {report.coverage.status === "matched" &&
          report.topHistoricalAreas.length > 0 && (
            <div className="finding-list">
              {report.topHistoricalAreas.map((area, index) => (
                <div className="finding-item" key={area.name}>
                  <span className="finding-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{area.name}</h3>
                    <p>
                      {area.historicalComplaintCount.toLocaleString("en-CA")}{" "}
                      aggregate historical complaints in this category.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        {report.headlines.map((headline) => (
          <p key={headline}>{headline}</p>
        ))}
      </section>
      <section className="report-section">
        <div className="report-section-heading">
          <span>02</span>
          <h2>What this means</h2>
        </div>
        <p>
          Historical patterns can help prioritize what to investigate. They do
          not establish the condition of this vehicle or replace a professional
          mechanical inspection.
        </p>
        {report.lockedSummary?.additionalHistoricalDetailAvailable && (
          <p className="fine-print">
            Additional historical detail is available in a future full report.
          </p>
        )}
      </section>
      <section className="report-section free-actions">
        <div className="report-section-heading"><span>03</span><h2>Before you arrange a visit</h2></div>
        <p>Use the model history as a prompt, not a verdict on this car. Get the vehicle-specific evidence from the seller.</p>
        <ol className="question-list">
          <li>Ask for the VIN and a current vehicle-history report. Check that the identifiers match.</li>
          <li>Request maintenance invoices and ask about repairs related to the areas above, when available.</li>
          <li>Confirm that an independent mechanic can inspect the vehicle before you commit to buying it.</li>
        </ol>
      </section>
      <section className="report-section">
        <div className="free-next-grid">
          <div>
            <p className="eyebrow">Still unresolved</p>
            <h2>The model is only part of the story.</h2>
            <p>
              Condition, service history, seller claims and price still need
              verification. Ask for records before arranging an independent
              inspection.
            </p>
          </div>
          <div>
            <p className="eyebrow">Full Buyer Report / preview</p>
            <h2>Prepare for this specific listing.</h2>
            <p>
              Rules-based listing concerns, seller questions and inspection
              prompts. No additional verified history.
            </p>
            <Link className="button button-primary" href="/check?step=choose">
              Explore report options
            </Link>
            <p className="fine-print">
              Planned price: $19.99 CAD. No charge in this preview.
            </p>
          </div>
        </div>
        <div className="button-row">
          <button
            className="button button-secondary"
            type="button"
            onClick={onRetry}
          >
            Try again
          </button>
          <Link className="button button-primary" href="/inspection">
            Prepare an inspection request
          </Link>
        </div>
      </section>
    </article>
  );
}
