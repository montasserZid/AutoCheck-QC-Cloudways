"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Clipboard,
  Printer,
  ShieldCheck,
} from "lucide-react";
import type { DemoBuyerReport, ReportFinding } from "@/types/domain";

function Findings({ items }: { items: ReportFinding[] }) {
  return items.length ? (
    <div className="finding-list">
      {items.map((item, i) => (
        <div className="finding-item" key={item.title}>
          <span className="finding-index">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p>
      No additional information gaps were identified in the confirmed fields.
      Claims still need independent verification.
    </p>
  );
}
function Section({
  title,
  id,
  number,
  children,
}: {
  title: string;
  id: string;
  number: number;
  children: ReactNode;
}) {
  return (
    <section id={id} className="report-section">
      <div className="report-section-heading">
        <span>{String(number).padStart(2, "0")}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
export function ReportView({
  report,
  example = false,
}: {
  report: DemoBuyerReport;
  example?: boolean;
}) {
  const free = report.reportType === "free";
  const [copyStatus, setCopyStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(report.sellerMessage);
      setCopyStatus("Message copied.");
    } catch {
      setCopyStatus(
        "Copy was unavailable. Select the message text to copy it.",
      );
    }
  }
  const riskClass =
    report.riskLevel === "Low"
      ? "low"
      : report.riskLevel === "Medium"
        ? "medium"
        : report.riskLevel === "Unknown"
          ? "unknown"
          : "high";
  return (
    <article className="report-shell">
      <div className="report-toolbar">
        <span>
          <ShieldCheck size={18} aria-hidden="true" /> AUTOCHECK QC /{" "}
          {example ? "EXAMPLE REPORT" : free ? "QUICK CHECK" : "BUYER REPORT"}
        </span>
        <div>
          <Link
            className="text-link"
            href={example ? "/check" : "/check?step=choose"}
          >
            {example ? "Check your own car" : "Report options"}
            <ArrowUpRight size={16} />
          </Link>
          <button
            className="icon-button"
            title="Print report"
            aria-label="Print report"
            onClick={() => window.print()}
          >
            <Printer size={18} />
          </button>
        </div>
      </div>
      <header className="report-banner">
        <div>
          <p className="eyebrow">
            {example
              ? "Example / illustrative listing"
              : free
                ? "Free Quick Check"
                : "Full Buyer Report / preview"}
          </p>
          <h1>{report.vehicleTitle}</h1>
          <p>
            Listing pre-screen<span className="dot-separator">/</span>Seller
            claims remain unverified
          </p>
        </div>
        <div className={`risk-summary ${riskClass}`}>
          <span>LISTING RISK</span>
          <strong>{report.riskLevel}</strong>
          {!free && (
            <small>
              {report.riskLevel === "Unknown"
                ? "Insufficient details"
                : `${report.riskScore} / 100 concern score`}
            </small>
          )}
        </div>
      </header>
      <div className="decision-summary">
        <div>
          <p className="eyebrow">Final recommendation</p>
          <h2>{report.finalRecommendation}</h2>
          <span className="meta-label">Should you inspect?</span>
          <p>{report.inspectionRecommendation}</p>
        </div>
        <div>
          <span className="meta-label">Top concern</span>
          <h3>{report.topConcern}</h3>
          <span className="meta-label">Best next action</span>
          <p>{report.nextStep}</p>
        </div>
      </div>
      <div className="report-layout">
        <aside className="report-nav" aria-label="Report sections">
          <span className="eyebrow">In this report</span>
          {(free
            ? [
                ["vehicle-summary", "Vehicle"],
                ["red-flags", "Red flags"],
                ["seller-questions", "Seller questions"],
                ["next-step", "Next step"],
              ]
            : [
                ["vehicle-summary", "The vehicle"],
                ["risk-score", "Risk & price"],
                ["red-flags", "Red flags & gaps"],
                ["model-checklist", "Model checklist"],
                ["seller-questions", "Ask the seller"],
                ["in-person", "Before buying"],
                ["inspection", "Inspection & decision"],
              ]
          ).map(([id, label]) => (
            <a href={`#${id}`} key={id}>
              {label}
              <ArrowRight size={14} />
            </a>
          ))}
          <p className="fine-print">
            Based on the details you confirmed. No history search or photo
            analysis performed.
          </p>
        </aside>
        <div className="report-body">
          <Section title="Vehicle Summary" id="vehicle-summary" number={1}>
            <dl className="summary-grid">
              {report.vehicleSummary.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </Section>
          {!free && (
            <>
              <Section
                title="First Impression"
                id="first-impression"
                number={2}
              >
                <p>{report.firstImpression}</p>
              </Section>
              <Section title="Risk Score" id="risk-score" number={3}>
                <div className="risk-layout">
                  <div className={`risk-number ${riskClass}`}>
                    <strong>
                      {report.riskLevel === "Unknown" ? "?" : report.riskScore}
                    </strong>
                    <span>
                      {report.riskLevel === "Unknown" ? "Unknown" : "/ 100"}
                    </span>
                  </div>
                  <div>
                    <h3>{report.riskLevel} listing risk</h3>
                    <p>
                      A rules-based concern score, not a failure probability or
                      mechanical grade. Missing information increases
                      uncertainty. A low score does not certify a safe car.
                    </p>
                  </div>
                </div>
                <details className="score-details">
                  <summary>What contributes to this score?</summary>
                  <ul>
                    {report.riskContributions.map((c) => (
                      <li key={c.label}>
                        <span>{c.label}</span>
                        <strong>+{c.points}</strong>
                      </li>
                    ))}
                  </ul>
                  <p>
                    Points are added and capped at 100. Low: 0-24; Medium:
                    25-49; High: 50-74; Very High: 75-100. If year, mileage and
                    price are all absent and no explicit concern is identified,
                    the level is Unknown.
                  </p>
                </details>
              </Section>
              <Section title="Price Check" id="price-check" number={4}>
                <Findings items={report.priceCheck} />
              </Section>
            </>
          )}
          <Section
            title="Biggest Red Flags"
            id="red-flags"
            number={free ? 2 : 5}
          >
            <p className="section-intro">
              Reported concerns and information gaps to resolve. These are not
              confirmed defects.
            </p>
            <Findings
              items={
                free
                  ? report.biggestRedFlags.slice(0, 3)
                  : report.biggestRedFlags
              }
            />
          </Section>
          {!free && (
            <>
              <Section
                title="Missing Information"
                id="missing-information"
                number={6}
              >
                <Findings items={report.missingInformation} />
              </Section>
              <Section
                title="Common Areas to Verify for This Model"
                id="model-checklist"
                number={7}
              >
                <p className="section-intro">
                  Equipment and maintenance vary by year and engine. These
                  checks do not establish that your vehicle has a known defect.
                </p>
                <Findings items={report.commonProblems} />
              </Section>
            </>
          )}
          <Section
            title="Questions to Ask the Seller"
            id="seller-questions"
            number={free ? 3 : 8}
          >
            <ol className="question-list">
              {(free
                ? report.sellerQuestions.slice(0, 3)
                : report.sellerQuestions
              ).map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </Section>
          {!free && (
            <>
              <Section
                title="Message to Send the Seller"
                id="seller-message"
                number={9}
              >
                <div className="seller-message">
                  <p>{report.sellerMessage}</p>
                  <button className="button button-secondary" onClick={copy}>
                    <Clipboard size={17} />
                    Copy Message
                  </button>
                  <span role="status" className="fine-print">
                    {copyStatus}
                  </span>
                </div>
              </Section>
              <Section
                title="What to Check in Person"
                id="in-person"
                number={10}
              >
                <Findings items={report.inPersonChecks} />
              </Section>
              <Section
                title="What Could Cost You Money"
                id="potential-costs"
                number={11}
              >
                <Findings items={report.potentialCosts} />
              </Section>
              <Section title="Negotiation Points" id="negotiation" number={12}>
                <Findings items={report.negotiationPoints} />
              </Section>
              <Section title="Deal Breakers" id="deal-breakers" number={13}>
                <ul className="compact-list">
                  {report.dealBreakers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </Section>
              <Section title="When to Walk Away" id="walk-away" number={14}>
                <p>{report.walkAway}</p>
              </Section>
              <Section
                title="Inspector Focus List"
                id="inspector-focus"
                number={15}
              >
                <Findings items={report.inspectorFocus} />
              </Section>
              <Section
                title="Inspection Recommendation"
                id="inspection"
                number={16}
              >
                <h3>Should you inspect?</h3>
                <p>{report.inspectionRecommendation}</p>
              </Section>
            </>
          )}
          <Section
            title="Final Recommendation"
            id="recommendation"
            number={free ? 4 : 17}
          >
            <h3
              className={`recommendation ${report.finalRecommendation === "Avoid" ? "high" : "medium"}`}
            >
              {report.finalRecommendation}
            </h3>
            <p>{report.nextStep}</p>
          </Section>
          {free && (
            <div className="upgrade-section">
              <p className="eyebrow">Go deeper before you decide</p>
              <h2>Take the full checklist with you.</h2>
              <p>
                Model checks, missing documents, negotiation points and a
                ready-to-send seller message.
              </p>
              <Link className="button button-primary" href="/check?step=choose">
                Get Full Buyer Report
                <ArrowRight size={18} />
              </Link>
              <small>
                $19.99 CAD planned price. Opens as a preview; no charge.
              </small>
            </div>
          )}
          <Section title="Next Step" id="next-step" number={free ? 5 : 18}>
            <p>{report.nextStep}</p>
            <div className="button-row">
              {report.finalRecommendation !== "Avoid" ? (
                <Link className="button button-primary" href="/inspection">
                  Book a Mobile Inspection
                  <ArrowUpRight size={18} />
                </Link>
              ) : (
                <a className="button button-primary" href="#seller-questions">Resolve Inspection Permission</a>
              )}
              <Link className="button button-secondary" href="/check?new=1">
                Check Another Car
              </Link>
            </div>
          </Section>
          <section className="report-disclaimer">
            <h2>{free ? "Disclaimer" : "19 / Disclaimer"}</h2>
            <p>{report.disclaimer}</p>
          </section>
        </div>
      </div>
    </article>
  );
}
