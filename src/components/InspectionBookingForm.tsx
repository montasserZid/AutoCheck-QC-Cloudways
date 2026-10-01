"use client";

import { FormEvent, useEffect, useState } from "react";
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
import type { InspectionRequest, Urgency } from "@/types/domain";

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

  useEffect(() => {
    const intake = getStoredIntake();
    const draft = readLocal<BookingFormState & { sourceVehicleKey?: string }>("booking-draft");
    const key = intake ? `${vehicleTitle(intake)}|${intake.vin ?? ""}` : "";
    const restore = draft && (draft.sourceVehicleKey ?? key) === key;

    setForm((current) => ({
      ...current,
      ...(restore && typeof draft.buyerName === "string" ? draft : {}),
      vehicleTitle: restore ? draft.vehicleTitle : intake ? vehicleTitle(intake) : "",
      vehicleVin: restore ? draft.vehicleVin : intake?.vin ?? "",
      vehicleAddress:
        restore ? draft.vehicleAddress : intake?.city ? `${intake.city}, QC` : "",
    }));
    setSourceVehicleKey(key);
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) setStorageOk(writeLocal("booking-draft", { ...form, sourceVehicleKey }));
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

    if (validationErrors.length > 0) return;

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
      reportId: report?.vehicleTitle === form.vehicleTitle ? report.id : undefined,
    };

    saveInspectionRequest(request);
    router.push("/inspection/confirmation");
  }

  if (!ready) return <p role="status">Preparing your inspection request...</p>;
  return (
    <div className="booking-layout">
      <aside className="booking-aside">
        <MapPin size={28} />
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
              <strong>Submit request</strong>
              <p>Vehicle, location and your preferred time.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Availability is checked</strong>
              <p>The location and timing need review.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Inspection time is confirmed</strong>
              <p>A request alone does not reserve a visit.</p>
            </div>
          </li>
        </ol>
        <p className="inline-note">
          <ShieldCheck size={20} />
          No automatic inspector assignment.
        </p>
      </aside>
      <form className="form-panel" onSubmit={submitBooking} noValidate>
        <div className="form-head">
          <p className="eyebrow">Mobile inspection request</p>
          <h1>Request a mobile inspection.</h1>
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
          <div className="form-errors" role="alert">
            <strong>Fix these items:</strong>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <fieldset>
          <legend>Buyer information</legend>
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
          <legend>Vehicle information</legend>
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
          <legend>Seller and location</legend>
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
          <legend>Timing</legend>
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

        <div className="form-actions">
          <button className="button button-primary" type="submit">
            Submit Inspection Request <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
