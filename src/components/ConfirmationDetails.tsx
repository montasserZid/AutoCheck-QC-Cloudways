"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardCheck, ArrowRight } from "lucide-react";
import { getStoredInspectionRequest } from "@/lib/localStorage";
import type { InspectionRequest } from "@/types/domain";
import { titleCaseStatus } from "@/lib/format";
import { VehicleIdentityPlate } from "./dossier/VehicleIdentityPlate";
export function ConfirmationDetails() {
  const [request, setRequest] = useState<InspectionRequest | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setRequest(getStoredInspectionRequest());
    setReady(true);
  }, []);
  if (!ready) return <section className="loading-panel" role="status"><p className="eyebrow">Your inspection plan</p><h1>Opening your saved details.</h1><div className="dossier-processing-rule" aria-hidden="true" /></section>;
  if (!request)
    return (
      <section className="empty-state">
        <h1>No inspection request to show yet.</h1>
        <p>
          Prepare a request to review the vehicle, location and preferred time
          here.
        </p>
        <Link className="button button-primary" href="/inspection">
          Prepare an inspection request
        </Link>
      </section>
    );
  return (
    <section className="confirmation-panel">
      <span className="confirmation-icon">
        <ClipboardCheck size={30} />
      </span>
      <p className="eyebrow">Saved on this device / {request.id}</p>
      <h1>
        Your inspection details{" "}
        <br />
        are in one place.
      </h1>
      <p className="lead">
        Thanks, {request.buyerName}. Your requested time is shown below. This is
        not a confirmed appointment.
      </p>
      <VehicleIdentityPlate title={request.vehicleTitle} vehicle={{ vin: request.vehicleVin }} compact stateLabel="SAVED LOCALLY · NO APPOINTMENT RESERVED" />
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
        <h2>Your next step is outside this preview.</h2>
        <p>
          Ask the seller to agree to an independent inspection. Contact a
          qualified inspector directly to confirm availability, scope and price
          before travelling.
        </p>
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
