"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReportPackage } from "@/types/domain";

const comparison = [
  ["Understand the model", "Available historical model-year information and complaint areas.", "Model-specific areas to verify alongside this listing."],
  ["Understand this listing", "Vehicle condition, seller claims and price remain unresolved.", "Rules-based concerns, information gaps and price-check guidance."],
  ["Prepare the conversation", "A starting point for your own questions.", "Seller questions and a ready-to-send message."],
  ["Decide what to do next", "Know the coverage and its limits.", "Buyer checklist, negotiation points and a final recommendation."],
];

export function PricingCards({ premium = false, onSelect }: {
  premium?: boolean; onSelect?: (type: ReportPackage) => void;
}) {
  const action = (type: ReportPackage) => {
    const name = type === "free" ? "Get Free Quick Check" : "Get Full Buyer Report";
    const className = `button button-${type === "full" ? "primary" : "secondary"}`;
    return onSelect ? <button type="button" className={className} onClick={() => onSelect(type)}>{name}<ArrowRight size={17} aria-hidden="true" /></button>
      : <Link className={className} href={`/check?package=${type}`}>{name}<ArrowRight size={17} aria-hidden="true" /></Link>;
  };
  return <div className="decision-comparison">
    <div className="comparison-register"><span>CHOOSE YOUR NEXT DECISION</span><span>ONE VEHICLE / TWO LEVELS OF CONTEXT</span></div>
    <div className="comparison-plans">
      <section className="plan-intro">
        <p className="eyebrow">01 / A useful starting point</p><h2>Free Quick Check</h2>
        <p>What can the model’s history tell you?</p>
        <div className="plan-number">$0 <small>CAD</small></div>
        <p className="plan-availability">Free · Historical coverage varies</p>
        {action("free")}
      </section>
      <section className="plan-intro full-plan">
        <p className="eyebrow">02 / A plan for this car</p><h2>Full Buyer Report</h2>
        <p>What should you resolve before going further?</p>
        <div className="plan-number">$19.99 <small>CAD / vehicle · planned</small></div>
        <p className="plan-availability">Preview available now · No payment collected</p>
        {action("full")}
      </section>
    </div>
    <div className="decision-matrix">
      {comparison.map(([question, free, full]) => <section className="comparison-row" key={question}>
        <h3>{question}</h3>
        <div><span className="comparison-mobile-label">FREE</span><p>{free}</p></div>
        <div><span className="comparison-mobile-label">FULL</span><p>{full}</p></div>
      </section>)}
    </div>
    <p className="comparison-boundary">Neither report verifies mechanical condition, vehicle history or market value. Both support a professional inspection.</p>
    {premium && <section className="human-review">
      <div><p className="eyebrow">Planned service / not available to order</p><h2>Premium Human Review</h2><p>A second pair of eyes on the listing and Full Buyer Report, with additional questions and negotiation guidance.</p></div>
      <div><strong>$49.99 <small>CAD / vehicle · planned</small></strong><Link className="text-link" href="/contact">Ask About Human Review <ArrowRight size={17} /></Link></div>
    </section>}
  </div>;
}
