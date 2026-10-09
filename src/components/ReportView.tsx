"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Clipboard, Check, Printer } from "lucide-react";
import type { DemoBuyerReport, ReportFinding, VehicleIntake } from "@/types/domain";
import { VehicleIdentityPlate } from "./dossier/VehicleIdentityPlate";
import { BuyerChecklist } from "./dossier/BuyerChecklist";

function Findings({ items }: { items: ReportFinding[] }) {
  return items.length ? <div className="finding-list">
    {items.map((item, index) => <details className="finding-item evidence-finding" key={item.title}>
      <summary><span className="finding-index">{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3></summary>
      <p>{item.detail}</p>
    </details>)}
  </div> : <p className="evidence-empty">No additional gaps were identified in the supplied fields. Claims still need independent verification.</p>;
}
function Section({ title, id, children, folded = false }: { title: string; id: string; children: ReactNode; folded?: boolean }) {
  return folded ? <details id={id} className="report-section evidence-section"><summary><span className="meta-label">Open evidence</span><h2>{title}</h2><span aria-hidden="true">+</span></summary><div className="evidence-content">{children}</div></details>
    : <section id={id} className="report-section"><div className="report-section-heading"><h2>{title}</h2></div>{children}</section>;
}
function Act({ id, number, title, children }: { id: string; number: string; title: string; children: ReactNode }) {
  return <section id={id} className="report-act"><header className="act-heading"><span>ACT {number}</span><h2>{title}</h2></header>{children}</section>;
}
export function ReportView({ report, example = false, vehicle }: { report: DemoBuyerReport; example?: boolean; vehicle?: VehicleIntake }) {
  const free = report.reportType === "free";
  const [copyStatus, setCopyStatus] = useState("");
  const [message, setMessage] = useState(report.sellerMessage);
  async function copy() {
    try { await navigator.clipboard.writeText(message); setCopyStatus("Message copied."); }
    catch { setCopyStatus("Copy was unavailable. Select the message text to copy it."); }
  }
  return <article className="report-shell decision-report dossier-report">
    <div className="report-toolbar">
      <span>AUTOCHECK / QC — {example ? "ILLUSTRATIVE DOSSIER" : free ? "QUICK CHECK" : "BUYER DOSSIER"}</span>
      <div><Link className="text-link" href={example ? "/check" : "/check?step=choose"}>{example ? "Check your own car" : "Report options"}<ArrowUpRight size={16} /></Link>
      <button className="icon-button" title="Print report" aria-label="Print report" onClick={() => window.print()}><Printer size={18} /></button></div>
    </div>
    <VehicleIdentityPlate vehicle={vehicle} title={vehicle ? undefined : report.vehicleTitle} compact stateLabel={example ? "ILLUSTRATIVE LISTING" : "REVIEWED DETAILS · NOT VERIFIED"} />
    <div className="report-layout">
      <nav className="report-nav" aria-label="Report sections">
        <span className="eyebrow">Your decision path</span>
        {[["act-decision", "I", "The decision"], ["act-evidence", "II", "What drives it"], ["act-unknown", "III", "Still unresolved"], ["act-action", "IV", "Your next moves"]].map(([id, number, label]) => <a href={"#" + id} key={id}><span>{number}</span>{label}<ArrowRight size={14} /></a>)}
        <p className="fine-print">A listing pre-screen. No independent condition, history or market-value verification.</p>
      </nav>
      <div className="report-body">
        <Act id="act-decision" number="I" title="The decision">
          <div className="dossier-verdict">
            <p className="eyebrow">{free ? "Free Quick Check" : "Full Buyer Report / preview"}</p>
            <h1>{report.finalRecommendation}</h1>
            <p className="verdict-next">{report.nextStep}</p>
            <div className="verdict-context"><div><span className="meta-label">Listing concern level</span><strong>{report.riskLevel}</strong><small>{report.riskLevel === "Unknown" ? "Insufficient details" : report.riskScore + " / 100 · rules-based concern score"}</small></div><p>Missing information can raise concern. This is not a mechanical grade, failure probability or verified condition.</p></div>
            <a className="button button-primary" href="#act-action">Plan your next move <ArrowRight size={18} /></a>
          </div>
          <div className="decision-focus"><span className="meta-label">The thing to resolve first</span><h2>{report.topConcern}</h2><p>{report.inspectionRecommendation}</p></div>
          {!free && <Section title="First impression" id="first-impression" folded><p>{report.firstImpression}</p></Section>}
        </Act>
        <Act id="act-evidence" number="II" title="What drives it">
          <Section title="What we know so far" id="vehicle-summary">
            <p className="section-intro">Listing and buyer-supplied details. Seller statements remain claims; none are independently verified.</p>
            <dl className="summary-grid">{report.vehicleSummary.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          </Section>
          {!free && <>
            <Section title="Put the asking price in context" id="price-check">
              <div className="price-analysis"><div className="price-context"><span className="meta-label">Seller’s asking price</span><strong>{report.vehicleSummary.find(item => /price/i.test(item.label))?.value ?? "Not supplied"}</strong><p>Asking price is not market value. No live comparables or independent valuation have been checked.</p></div><div><p className="eyebrow">What to investigate</p><Findings items={report.priceCheck} /></div></div>
            </Section>
            <Section title="Common areas to verify for this model" id="model-checklist" folded>
              <p className="section-intro">Equipment and maintenance vary by year and engine. These checks do not establish that your vehicle has a known defect.</p><Findings items={report.commonProblems} />
            </Section>
            <Section title="How the concern score is formed" id="risk-score" folded>
              <p>A rules-based concern score, not a failure probability or mechanical grade. Missing information increases uncertainty. A low score does not certify a safe car.</p>
              <ul className="score-contributions">{report.riskContributions.map(item => <li key={item.label}><span>{item.label}</span><strong>+{item.points}</strong></li>)}</ul>
              <p className="fine-print">Points are added and capped at 100. Low: 0–24; Medium: 25–49; High: 50–74; Very High: 75–100. If year, mileage and price are all absent and no explicit concern is identified, the level is Unknown.</p>
              <ul className="compact-list">{report.riskDrivers.map(driver => <li key={driver}>{driver}</li>)}</ul>
            </Section>
          </>}
        </Act>
        <Act id="act-unknown" number="III" title="What remains unresolved">
          <Section title="What needs a closer look" id="red-flags"><p className="section-intro">Reported concerns and information gaps. These are not confirmed defects.</p><Findings items={free ? report.biggestRedFlags.slice(0, 3) : report.biggestRedFlags} /></Section>
          {!free && <>
            <Section title="Questions the listing leaves open" id="missing-information"><Findings items={report.missingInformation} /></Section>
            <Section title="Deal breakers to keep in view" id="deal-breakers" folded><ul className="compact-list">{report.dealBreakers.map(item => <li key={item}>{item}</li>)}</ul></Section>
            <Section title="When to walk away" id="walk-away" folded><p>{report.walkAway}</p></Section>
          </>}
        </Act>
        <Act id="act-action" number="IV" title="Your next moves">
          <div className="seller-workspace">
            <Section title="Ask the right questions" id="seller-questions"><p className="section-intro">Start with the seller. Keep their answers with your vehicle records.</p><ol className="question-list">{(free ? report.sellerQuestions.slice(0, 3) : report.sellerQuestions).map(question => <li key={question}>{question}</li>)}</ol></Section>
            {!free && <Section title="Your message, ready to send" id="seller-message"><div className="seller-message"><label htmlFor="buyer-message">Make it your own before sending</label><textarea id="buyer-message" rows={10} value={message} onChange={event => { setMessage(event.target.value); setCopyStatus(""); }} /><p className="print-message">{message}</p><button className="button button-secondary" onClick={copy}>{copyStatus === "Message copied." ? <Check size={17} /> : <Clipboard size={17} />}Copy Message</button><span role="status" className="copy-feedback">{copyStatus}</span></div></Section>}
          </div>
          {!free && <>
            <Section title="At the vehicle" id="in-person"><BuyerChecklist items={report.inPersonChecks} label="BUYER CHECKLIST" /></Section>
            <Section title="What could cost you money" id="potential-costs" folded><Findings items={report.potentialCosts} /></Section>
            <Section title="Negotiation points" id="negotiation" folded><Findings items={report.negotiationPoints} /></Section>
            <Section title="For the professional inspector" id="inspector-focus" folded><BuyerChecklist items={report.inspectorFocus} label="MECHANIC BRIEF" /></Section>
            <Section title="Should you arrange an inspection?" id="inspection" folded><p>{report.inspectionRecommendation}</p></Section>
          </>}
          <Section title="Your recommendation, in context" id="recommendation" folded><h3>{report.finalRecommendation}</h3><p>{report.nextStep}</p></Section>
          {free && <div className="upgrade-section"><p className="eyebrow">Reduce more uncertainty</p><h2>Take the full checklist with you.</h2><p>Model checks, missing documents, negotiation points and a ready-to-send seller message.</p><Link className="button button-secondary" href="/check?step=choose">Get Full Buyer Report <ArrowRight size={18} /></Link><small>$19.99 CAD planned price. Opens as a preview; no charge.</small></div>}
          <Section title="One clear next step" id="next-step"><p>{report.nextStep}</p><div className="button-row">{report.finalRecommendation !== "Avoid" ? <Link className="button button-primary" href="/inspection">Prepare an inspection request <ArrowUpRight size={18} /></Link> : <a className="button button-primary" href="#seller-questions">Resolve Inspection Permission</a>}<Link className="button button-secondary" href="/check?new=1">Check Another Car</Link></div></Section>
        </Act>
        <section className="report-disclaimer"><h2>Know the limits of this dossier.</h2><p>{report.disclaimer}</p></section>
      </div>
    </div>
  </article>;
}
