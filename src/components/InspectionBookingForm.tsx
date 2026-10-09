"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getStoredIntake,
  getStoredReport,
  saveInspectionRequest,
  readLocal,
  writeLocal,
} from "@/lib/localStorage";
import { validateBooking, localDate } from "@/lib/validation";
import { vehicleTitle } from "@/lib/reportEngine";
import { ArrowRight, MapPin, ShieldCheck } from "lucide-react";
import type { InspectionRequest, Urgency, VehicleIntake } from "@/types/domain";
import { VehicleIdentityPlate } from "./dossier/VehicleIdentityPlate";

interface BookingFormState {
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
  vehicleTitle: string;
  vehicleVin: string;
  sellerContact: string;
  vehicleAddress: string;
  preferredDate: string;
  preferredTime: string;
  urgency: Urgency;
  notes: string;
}

const initialBooking: BookingFormState = {
  buyerName: "",
  buyerPhone: "",
  buyerEmail: "",
  vehicleTitle: "",
  vehicleVin: "",
  sellerContact: "",
  vehicleAddress: "",
  preferredDate: "",
  preferredTime: "",
  urgency: "24_48_hours",
  notes: "",
};

export function InspectionBookingForm() {
  const router = useRouter();
  const [form, setForm] = useState<BookingFormState>(initialBooking);
  const [errors, setErrors] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [sourceVehicleKey, setSourceVehicleKey] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [vehicle, setVehicle] = useState<VehicleIntake | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const intake = getStoredIntake();
    setVehicle(intake);
    const draft = readLocal<BookingFormState & { sourceVehicleKey?: string }>(
      "booking-draft",
    );
    const key = intake ? `${vehicleTitle(intake)}|${intake.vin ?? ""}` : "";
    const restore = draft && (draft.sourceVehicleKey ?? key) === key;

    setForm((current) => ({
      ...current,
      ...(restore && typeof draft.buyerName === "string" ? draft : {}),
      vehicleTitle: restore
        ? draft.vehicleTitle
        : intake
          ? vehicleTitle(intake)
          : "",
      vehicleVin: restore ? draft.vehicleVin : (intake?.vin ?? ""),
      vehicleAddress: restore
        ? draft.vehicleAddress
        : intake?.city
          ? `${intake.city}, QC`
          : "",
    }));
    setSourceVehicleKey(key);
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      setStorageOk(writeLocal("booking-draft", { ...form, sourceVehicleKey }));
  }, [ready, form, sourceVehicleKey]);

  function updateField<K extends keyof BookingFormState>(
    key: K,
    value: BookingFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validate(): string[] {
    return validateBooking(form);
  }

  function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationErrors = validate();
    setErrors(validationErrors);

    if (validationErrors.length > 0) {
      setReviewing(false);
      setTimeout(() => errorSummary.current?.focus(), 0);
      return;
    }
    if (!reviewing) {
      setReviewing(true);
      setTimeout(() => reviewHeading.current?.focus(), 0);
      return;
    }

    const report = getStoredReport();
    const request: InspectionRequest = {
      id: `QC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      submittedAt: new Date().toISOString(),
      buyerName: form.buyerName.trim(),
      buyerPhone: form.buyerPhone.trim(),
      buyerEmail: form.buyerEmail.trim(),
      vehicleTitle: form.vehicleTitle.trim(),
      vehicleVin: form.vehicleVin.trim() || undefined,
      sellerContact: form.sellerContact.trim(),
      vehicleAddress: form.vehicleAddress.trim(),
      preferredDate: form.preferredDate,
      preferredTime: form.preferredTime,
      urgency: form.urgency,
      notes: form.notes.trim(),
      reportId:
        report?.vehicleTitle === form.vehicleTitle ? report.id : undefined,
    };

    saveInspectionRequest(request);
    router.push("/inspection/confirmation");
  }

  if (!ready)
    return (
      <section className="loading-panel" role="status">
        <h1>Preparing your inspection request.</h1>
        <p>Restoring available vehicle details.</p>
      </section>
    );
  return (
    <div className="booking-layout">
      <aside className="booking-aside">
        <VehicleIdentityPlate vehicle={vehicle && form.vehicleTitle === vehicleTitle(vehicle) ? { ...vehicle, vin: form.vehicleVin } : { vin: form.vehicleVin }} title={vehicle && form.vehicleTitle === vehicleTitle(vehicle) ? undefined : form.vehicleTitle || "Your inspection plan"} compact stateLabel="INSPECTION PREPARATION" />
        <MapPin size={20} aria-hidden="true" />
        <p className="eyebrow">Montreal & surrounding areas</p>
        <h2>From a promising listing to a closer look.</h2>
        <p>
          Have the seller agree to an independent inspection before choosing a
          time.
        </p>
        <ol className="booking-process">
          <li>
            <span>01</span>
            <div>
              <strong>Prepare details</strong>
              <p>Vehicle, location and your preferred time.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Review your plan</strong>
              <p>Check the location and preferred timing.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Save preview</strong>
              <p>Saved on this device. No appointment reserved.</p>
            </div>
          </li>
        </ol>
        <p className="inline-note">
          <ShieldCheck size={20} />
          Preview only. No inspector is contacted.
        </p>
      </aside>
      <form className="form-panel" onSubmit={submitBooking} noValidate>
        <div className="request-register"><span className={!reviewing ? "active" : ""}>01 / Prepare details</span><span className={reviewing ? "active" : ""}>02 / Review & save</span></div>
        <div className="form-head">
          <p className="eyebrow">Mobile inspection request</p>
          <h1>Plan the closer look.</h1>
          <p>
            Tell us about the car, the location and a time that works for you.
            Required fields are marked *.
          </p>
          <p className="notice">
            Preview request: details are saved on this device. Live booking is
            not enabled, so no inspector is contacted and no appointment is
            reserved.
          </p>
        </div>
        {!storageOk && (
          <p className="notice" role="status">
            This browser cannot retain your draft after refresh. Keep this tab
            open.
          </p>
        )}

        {errors.length > 0 ? (
          <div
            className="form-errors"
            role="alert"
            tabIndex={-1}
            ref={errorSummary}
          >
            <strong>Fix these items:</strong>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div hidden={reviewing}>
          <fieldset>
            <legend>01 / Your details</legend>
            <div className="form-grid">
              <label>
                Full name *
                <input
                  autoComplete="name"
                  required
                  maxLength={100}
                  value={form.buyerName}
                  onChange={(event) =>
                    updateField("buyerName", event.target.value)
                  }
                />
              </label>
              <label>
                Phone *
                <input
                  inputMode="tel"
                  type="tel"
                  autoComplete="tel"
                  required
                  maxLength={30}
                  value={form.buyerPhone}
                  onChange={(event) =>
                    updateField("buyerPhone", event.target.value)
                  }
                />
              </label>
              <label>
                Email *
                <input
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={200}
                  value={form.buyerEmail}
                  onChange={(event) =>
                    updateField("buyerEmail", event.target.value)
                  }
                />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>02 / The vehicle</legend>
            <div className="form-grid">
              <label>
                Vehicle *
                <input
                  value={form.vehicleTitle}
                  onChange={(event) =>
                    updateField("vehicleTitle", event.target.value)
                  }
                />
              </label>
              <label>
                VIN if available
                <input
                  value={form.vehicleVin}
                  maxLength={17}
                  onChange={(event) =>
                    updateField("vehicleVin", event.target.value.toUpperCase())
                  }
                />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>03 / Where to inspect</legend>
            <label>
              Seller contact *
              <input
                value={form.sellerContact}
                placeholder="Name, phone, email, or Marketplace profile"
                onChange={(event) =>
                  updateField("sellerContact", event.target.value)
                }
              />
            </label>
            <label>
              Vehicle location *
              <input
                value={form.vehicleAddress}
                placeholder="Street, area, or city"
                onChange={(event) =>
                  updateField("vehicleAddress", event.target.value)
                }
              />
            </label>
          </fieldset>

          <fieldset>
            <legend>04 / Your preferred timing</legend>
            <div className="form-grid">
              <label>
                Preferred date *
                <input
                  type="date"
                  min={localDate()}
                  value={form.preferredDate}
                  onChange={(event) =>
                    updateField("preferredDate", event.target.value)
                  }
                />
              </label>
              <label>
                Preferred time *
                <input
                  type="time"
                  value={form.preferredTime}
                  onChange={(event) =>
                    updateField("preferredTime", event.target.value)
                  }
                />
              </label>
              <label>
                Urgency
                <select
                  value={form.urgency}
                  onChange={(event) =>
                    updateField("urgency", event.target.value as Urgency)
                  }
                >
                  <option value="today">Today</option>
                  <option value="24_48_hours">24-48 hours</option>
                  <option value="this_week">This week</option>
                  <option value="flexible">Flexible</option>
                </select>
              </label>
            </div>
            <label>
              Notes
              <textarea
                rows={5}
                maxLength={4000}
                value={form.notes}
                placeholder="Anything the inspector should know: seller availability, parking, symptoms, warning lights, or urgent concerns."
                onChange={(event) => updateField("notes", event.target.value)}
              />
            </label>
          </fieldset>
        </div>
        {reviewing && (
          <section className="booking-review">
            <p className="eyebrow">Review before saving</p>
            <h2 tabIndex={-1} ref={reviewHeading}>
              Does everything look right?
            </h2>
            <dl className="summary-grid">
              {[
                ["Vehicle", form.vehicleTitle],
                ["VIN", form.vehicleVin || "Not supplied"],
                ["Buyer", form.buyerName],
                ["Phone", form.buyerPhone],
                ["Email", form.buyerEmail],
                ["Seller contact", form.sellerContact],
                ["Location", form.vehicleAddress],
                [
                  "Preferred time",
                  `${form.preferredDate} at ${form.preferredTime}`,
                ],
                ["Urgency", form.urgency.replaceAll("_", " ")],
                ["Notes", form.notes || "None"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="notice">
              Saving creates a local preview only. This does not send a request,
              reserve a time, or contact an inspector.
            </p>
          </section>
        )}
        <div className="form-actions">
          {reviewing && (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setReviewing(false);
                setTimeout(
                  () =>
                    document
                      .querySelector<HTMLInputElement>(
                        'input[autocomplete="name"]',
                      )
                      ?.focus(),
                  0,
                );
              }}
            >
              Edit details
            </button>
          )}
          <button className="button button-primary" type="submit">
            {reviewing
              ? "Save Inspection Request"
              : "Review Inspection Request"}{" "}
            <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
