"use client";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileCheck2,
  FileText,
  UserRoundCheck,
} from "lucide-react";
import type { ReportPackage } from "@/types/domain";

export function PricingCards({
  premium = false,
  onSelect,
}: {
  premium?: boolean;
  onSelect?: (type: ReportPackage) => void;
}) {
  const plans = [
    {
      id: "free",
      name: "Free Quick Check",
      price: "$0",
      who: "For your first look at a listing.",
      icon: FileText,
      features: [
        "Basic risk level",
        "Up to 3 red flags or information gaps",
        "3 questions to ask the seller",
        "Simple next-step recommendation",
      ],
      cta: "Get Free Quick Check",
    },
    {
      id: "full",
      name: "Full Buyer Report",
      price: "$19.99",
      who: "For the car you are seriously considering.",
      icon: FileCheck2,
      features: [
        "Full risk analysis and detailed red flags",
        "Missing information and price-check guidance",
        "Model-specific areas to verify",
        "Seller questions and a ready-to-send message",
        "Negotiation points and inspection checklist",
        "Final recommendation and next-step guidance",
      ],
      cta: "Get Full Buyer Report",
    },
    ...(premium
      ? [
          {
            id: "premium",
            name: "Premium Human Review",
            price: "$49.99",
            who: "For buyers who want a second pair of eyes.",
            icon: UserRoundCheck,
            features: [
              "Full Buyer Report",
              "Human review of the listing and report",
              "Additional questions and negotiation guidance",
              "Not available to order yet",
            ],
            cta: "Ask About Human Review",
          },
        ]
      : []),
  ];
  return (
    <div className={`pricing-grid ${premium ? "three" : ""}`}>
      {plans.map((p) => (
        <article
          className={`comparison-card ${p.id === "full" ? "highlighted" : ""}`}
          key={p.id}
        >
          <div className="plan-top">
            <p.icon size={24} aria-hidden="true" />
            <span>
              {p.id === "full"
                ? "A closer look"
                : p.id === "premium"
                  ? "Planned service"
                  : "Start here"}
            </span>
          </div>
          <h2>{p.name}</h2>
          <p>{p.who}</p>
          <div className="price">
            {p.price}
            <small> CAD{p.id !== "free" ? " / vehicle" : ""}</small>
          </div>
          <ul>
            {p.features.map((f) => (
              <li key={f}>
                <Check size={16} aria-hidden="true" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          {onSelect && p.id !== "premium" ? (
            <button
              type="button"
              className={`button button-${p.id === "full" ? "primary" : "secondary"}`}
              onClick={() => onSelect(p.id as ReportPackage)}
            >
              {p.cta}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          ) : (
            <Link
              className={`button button-${p.id === "full" ? "primary" : "secondary"}`}
              href={p.id === "premium" ? "/contact" : `/check?package=${p.id}`}
            >
              {p.cta}
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          )}
        </article>
      ))}
    </div>
  );
}
