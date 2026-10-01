"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { getStoredInspectionRequest } from "@/lib/localStorage";
import type { InspectionRequest } from "@/types/domain";
import { titleCaseStatus } from "@/lib/format";
export function ConfirmationDetails() {
  const [request, setRequest] = useState<InspectionRequest | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setRequest(getStoredInspectionRequest());
    setReady(true);
  }, []);
  if (!ready) return <p role="status">Loading request...</p>;
  if (!request)
    return (
      <section className="empty-state">
        <h1>No inspection request to show yet.</h1>
        <p>
          Prepare a request to review the vehicle, location and preferred time
          here.
        </p>
        <Link className="button button-primary" href="/inspection">
          Book a Mobile Inspection
        </Link>
      </section>
    );
  return (
    <section className="confirmation-panel">
      <span className="confirmation-icon">
        <Check size={30} />
      </span>
      <p className="eyebrow">Request saved / {request.id}</p>
      <h1>
        Your inspection details
        <br />
        are in one place.
      </h1>
      <p className="lead">
        Thanks, {request.buyerName}. Your requested time is shown below. This is
        not a confirmed appointment.
      </p>
      <dl className="summary-grid">
        {[
          ["Vehicle", request.vehicleTitle],
          ["Inspection location", request.vehicleAddress],
          [
            "Requested time",
            `${request.preferredDate} at ${request.preferredTime}`,
          ],
          ["Buyer", request.buyerName],
          ["Phone", request.buyerPhone],
          ["Email", request.buyerEmail],
          ["Seller contact", request.sellerContact],
          ["Urgency", titleCaseStatus(request.urgency)],
          ["VIN", request.vehicleVin || "Not provided"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="next-steps">
        <h2>What happens next?</h2>
        <p>
          Once live inspection booking is enabled, these details can be used to
          coordinate availability and confirm the time and price with you.
        </p>
        <p className="notice">
          This preview saved the request on this device only. No request was
          sent, no inspector was contacted and no follow-up will be sent.
        </p>
      </div>
      <div className="button-row">
        <Link className="button button-secondary" href="/inspection">
          Edit Request
        </Link>
        <Link className="button button-primary" href="/check?new=1">
          Check Another Car
          <ArrowRight size={18} />
        </Link>
      </div>
    </section>
  );
}
