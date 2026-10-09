"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import type { VehicleIntake } from "@/types/domain";

type FieldKey = "year" | "make" | "model" | "trim" | "mileageKm" | "askingPriceCad" | "city" | "vin" | "listingTitle" | "sellerName" | "location" | "transmission" | "drivetrain" | "engine" | "priceCurrency" | "sellerType" | "carfaxStatus" | "accidentHistoryMentioned" | "rebuiltStatus" | "inspectionAllowed" | "maintenanceRecords";
interface Definition { key: FieldKey; label: string; numeric?: boolean; required?: boolean; claim?: boolean; options?: [string, string][] }
const fields: Definition[] = [
  { key: "make", label: "Make", required: true }, { key: "model", label: "Model", required: true },
  { key: "year", label: "Year", numeric: true }, { key: "trim", label: "Trim" },
  { key: "mileageKm", label: "Mileage (km)", numeric: true }, { key: "askingPriceCad", label: "Asking price (CAD)", numeric: true },
  { key: "priceCurrency", label: "Price currency" }, { key: "city", label: "City" }, { key: "location", label: "Listing location" },
  { key: "vin", label: "VIN" }, { key: "listingTitle", label: "Listing title" }, { key: "sellerName", label: "Seller / dealer" },
  { key: "transmission", label: "Transmission" }, { key: "drivetrain", label: "Drivetrain" }, { key: "engine", label: "Engine" },
  { key: "sellerType", label: "Seller type", options: [["private", "Private seller"], ["dealer", "Dealer"]] },
  { key: "carfaxStatus", label: "Carfax", claim: true, options: [["available", "Seller says available"], ["not_available", "Not available"]] },
  { key: "accidentHistoryMentioned", label: "Accident history", claim: true, options: [["yes", "Accident reported"], ["no", "Seller says no accidents"]] },
  { key: "rebuiltStatus", label: "Rebuilt / salvage status", claim: true, options: [["yes", "Rebuilt or salvage reported"], ["no", "Seller says not rebuilt / salvage"]] },
  { key: "inspectionAllowed", label: "Independent inspection", claim: true, options: [["yes", "Allowed"], ["no", "Refused"]] },
  { key: "maintenanceRecords", label: "Maintenance records", claim: true, options: [["yes", "Seller says available"], ["no", "Not available"]] },
];
const missing = (value: unknown) => value == null || value === "" || value === "unknown";

function Editor({ definition, value, provenance, error, children }: {
  definition: Definition; value: VehicleIntake[FieldKey]; provenance: string; error?: string; children: ReactNode;
}) {
  const [editing, setEditing] = useState(Boolean(definition.required && missing(value)));
  const expanded = editing || Boolean(error);
  const display = missing(value) ? "Not supplied" : definition.options?.find(([key]) => key === value)?.[1] ?? (typeof value === "number" && definition.key !== "year" ? value.toLocaleString("en-CA") : String(value));
  return <div className={`evidence-editor ${expanded ? "is-editing" : ""}`}>
    <button id={`toggle-${definition.key}`} type="button" className="evidence-toggle" aria-expanded={expanded} aria-controls={`edit-${definition.key}`} onClick={() => setEditing(!editing)}>
      <span className="evidence-label">{definition.label}{definition.required && " *"}<small className={definition.claim ? "claim-source" : ""}>{provenance}</small></span>
      <strong className={missing(value) ? "value-unknown" : ""}>{display}</strong>
      <span className="edit-affordance">{expanded ? "Close" : missing(value) ? "Add" : "Edit"}<ArrowUpRight size={14} aria-hidden="true" /></span>
    </button>
    <div className="evidence-edit-content" id={`edit-${definition.key}`} hidden={!expanded}>
      {children}
      {definition.claim && <p className="fine-print">This remains a seller statement. AutoCheck has not independently verified it.</p>}
      <button type="button" className="text-link" onClick={() => { setEditing(false); document.getElementById(`toggle-${definition.key}`)?.focus(); }} disabled={Boolean(error)}><Check size={14} aria-hidden="true" />Done editing</button>
    </div>
  </div>;
}

export function VehicleReviewEvidence({ form, found, uncertain, errors, update }: {
  form: VehicleIntake; found: string[]; uncertain: string[]; errors: Record<string, string>;
  update: <K extends keyof VehicleIntake>(key: K, value: VehicleIntake[K]) => void;
}) {
  // Keep group membership stable during edits so a keystroke never moves focus.
  // Labels still reflect current provenance; a new review re-evaluates groups.
  const [groups] = useState(() => fields.map(definition => ({ definition, group:
    (definition.required && missing(form[definition.key])) || definition.claim || uncertain.includes(definition.key) ? "confirm"
      : missing(form[definition.key]) ? "unknown" : found.includes(definition.key) ? "found" : "confirm"
  })));
  const render = (definition: Definition) => {
    const { key, label, numeric, required, options } = definition;
    const provenance = missing(form[key]) ? "Not stated · ask later" : uncertain.includes(key) ? "Uncertain extraction · please confirm" : found.includes(key) ? definition.claim ? "Seller claim · extracted" : "Extracted from listing" : "Buyer supplied · check against the ad";
    return <Editor key={key} definition={definition} value={form[key]} provenance={provenance} error={errors[key]}>
      <label htmlFor={key}>{label}{required && " *"}</label>
      {options ? <select id={key} value={String(form[key])} onChange={e => update(key, e.target.value as VehicleIntake[typeof key])}>
        <option value="unknown">Unknown / not stated</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select> : <input id={key} name={key} type={numeric ? "number" : "text"} inputMode={numeric ? "numeric" : "text"} value={form[key] ?? ""} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `${key}-error` : undefined} maxLength={key === "vin" ? 17 : 100} placeholder={numeric ? "Unknown" : key === "vin" ? "Not provided" : ""} onChange={e => update(key, numeric ? e.target.value === "" ? null : Number(e.target.value) : key === "vin" ? e.target.value.toUpperCase() : e.target.value)} />}
      {errors[key] && <small id={`${key}-error`} className="field-error">{errors[key]}</small>}
    </Editor>;
  };
  return <div className="review-evidence">
    {([
      ["found", "01", "Found in the listing", "Collected from the ad. Read through the values; edit anything that looks off."],
      ["confirm", "02", "Needs your confirmation", "Check these details against the ad. Seller claims remain unverified, even after you review them."],
      ["unknown", "03", "Still unknown", "No need to guess. Add what you know, or carry these questions into the seller conversation."],
    ] as const).map(([group, number, title, description]) => {
      const members = groups.filter(item => item.group === group);
      const content = <><div className="dossier-section-heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div><small>{members.length} fields</small></div>{members.length ? members.map(({ definition }) => render(definition)) : <p className="evidence-empty">No fields in this group. Continue with the information you have.</p>}</>;
      return group === "unknown" ? <details className="unknown-evidence" key={group} open={members.some(({ definition }) => errors[definition.key]) ? true : undefined}><summary>Still unknown <span>{members.length} optional details · add what you know</span></summary>{content}</details> : <section key={group} className="evidence-group">{content}</section>;
    })}
  </div>;
}
