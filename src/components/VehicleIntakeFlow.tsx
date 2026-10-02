"use client";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Link2,
  ImagePlus,
  PenLine,
  ShieldCheck,
  X,
} from "lucide-react";
import type { VehicleIntake } from "@/types/domain";
import { emptyIntake, extractListing } from "@/lib/listingExtraction";
import { extractListingUrl } from "@/lib/listingUrlClient";
import { formatFileSize } from "@/lib/format";
import {
  getStoredIntake,
  readLocal,
  removeLocal,
  writeLocal,
  saveIntake,
  saveReportType,
  saveSubmittedIntakeContext,
} from "@/lib/localStorage";
import {
  validateIntake,
  validatePhotos,
  validListingUrl,
} from "@/lib/validation";
import { vehicleTitle } from "@/lib/reportEngine";
import { finalizeIntake } from "@/lib/intakeFinalization";
import { ProgressSteps } from "./ProgressSteps";
import { PricingCards } from "./PricingCards";

type Method = "text" | "url" | "images" | "manual";
interface Draft {
  form: VehicleIntake;
  step: number;
  method: Method;
  found: string[];
  uncertain: string[];
  submissionKey?: string;
}
const methods = [
  { id: "text", label: "Ad text", icon: FileText },
  { id: "url", label: "Listing link", icon: Link2 },
  { id: "images", label: "Screenshots", icon: ImagePlus },
  { id: "manual", label: "Manual", icon: PenLine },
] as const;
export function VehicleIntakeFlow() {
  const router = useRouter();
  const [form, setForm] = useState<VehicleIntake>(emptyIntake);
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<Method>("text");
  const [found, setFound] = useState<string[]>([]);
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [urlStatus, setUrlStatus] = useState<"idle" | "retrieving">("idle");
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [submissionKey, setSubmissionKey] = useState<string>();
  const [finalizing, setFinalizing] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const submissionKeyRef = useRef<string | undefined>(undefined);
  const finalizingRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stored = getStoredIntake();
    const draft = readLocal<Draft>("intake-draft");
    const consumeParams = (...keys: string[]) => {
      let changed = false;
      keys.forEach((key) => {
        if (params.has(key)) {
          params.delete(key);
          changed = true;
        }
      });
      if (changed) {
        const next = params.toString();
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${next ? `?${next}` : ""}`,
        );
      }
    };
    if (params.has("new")) {
      setForm(emptyIntake);
      removeLocal("intake-draft");
      removeLocal("intake");
      removeLocal("report");
      removeLocal("report-type");
      removeLocal("submitted-intake");
      consumeParams("new");
    } else if (params.get("step") === "choose" && stored) {
      setForm(stored);
      setStep(2);
      consumeParams("step");
    } else if (
      draft &&
      draft.form &&
      typeof draft.form.listingText === "string" &&
      Array.isArray(draft.form.photos)
    ) {
      setForm({ ...emptyIntake, ...draft.form });
      setStep([0, 1, 2].includes(draft.step) ? draft.step : 0);
      setMethod(
        methods.some((m) => m.id === draft.method) ? draft.method : "text",
      );
      setFound(draft.found ?? []);
      setUncertain(draft.uncertain ?? []);
      setSubmissionKey(draft.submissionKey);
      submissionKeyRef.current = draft.submissionKey;
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      setStorageOk(
        writeLocal("intake-draft", { form, step, method, found, uncertain, submissionKey }),
      );
  }, [form, step, method, found, uncertain, submissionKey, ready]);
  function changeStep(next: number) {
    setStep(next);
    setErrors({});
    setNotice("");
    window.scrollTo({ top: 0 });
    setTimeout(() => heading.current?.focus(), 0);
  }
  function update<K extends keyof VehicleIntake>(
    key: K,
    value: VehicleIntake[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
    setSubmissionKey(undefined);
    submissionKeyRef.current = undefined;
    setFound((keys) => keys.filter((field) => field !== key));
    setUncertain((keys) => keys.filter((field) => field !== key));
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
  }
  function files(event: ChangeEvent<HTMLInputElement>) {
    const next = [
      ...form.photos,
      ...Array.from(event.target.files ?? []).map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      })),
    ];
    const error = validatePhotos(next);
    if (error) setErrors({ photos: error });
    else {
      update("photos", next);
      setErrors({});
    }
    event.target.value = "";
  }
  async function provide(event: FormEvent) {
    event.preventDefault();
    if (!validListingUrl(form.listingUrl ?? "")) {
      setErrors({
        listingUrl: "Use a complete http:// or https:// listing link.",
      });
      return;
    }
    if (method === "manual") {
      changeStep(1);
      return;
    }
    if (method === "url") {
      const listingUrl = form.listingUrl?.trim() ?? "";
      if (!listingUrl) {
        setErrors({ listingUrl: "Paste the listing link first." });
        return;
      }
      setErrors({});
      setUrlStatus("retrieving");
      setNotice("Reading listing...");
      const response = await extractListingUrl(listingUrl);
      setUrlStatus("idle");
      if (response.ok) {
        const extracted = response.extraction;
        setForm((f) => ({
          ...emptyIntake,
          ...f,
          ...extracted.details,
          listingUrl: extracted.details.listingUrl ?? f.listingUrl,
          listingText: f.listingText,
          photos: f.photos,
        }));
        setFound(extracted.found);
        setUncertain(extracted.uncertain);
        changeStep(1);
        setNotice(
          response.status === "extracted"
            ? "Listing extracted. Review and correct anything that looks off before continuing."
            : response.status === "partial"
              ? "We found part of the listing. Complete or correct the missing details before continuing."
              : "We reached the listing, but it did not expose vehicle details we could read automatically.",
        );
        return;
      }
      setNotice(
        `${response.error} Paste the listing description below for deterministic text extraction, or choose Manual entry.`,
      );
      setMethod("text");
      return;
    }
    if (!form.listingText.trim()) {
      if (form.photos.length) {
        changeStep(1);
        return;
      }
      setErrors({
        listingText:
          "Paste the ad text, add a listing link or image, or choose Manual.",
      });
      return;
    }
    const result = extractListing(form.listingText);
    setForm((f) => ({
      ...emptyIntake,
      listingUrl: f.listingUrl,
      listingText: f.listingText,
      photos: f.photos,
      ...result.details,
    }));
    setFound(result.found);
    setUncertain(result.uncertain);
    changeStep(1);
  }
  async function review(event: FormEvent) {
    event.preventDefault();
    const next = validateIntake(form);
    setErrors(next);
    if (Object.keys(next).length) {
      setTimeout(
        () =>
          document
            .querySelector<HTMLInputElement>("[aria-invalid=true]")
            ?.focus(),
        0,
      );
      return;
    }
    if (finalizingRef.current) return;
    const key = submissionKeyRef.current ?? crypto.randomUUID();
    submissionKeyRef.current = key;
    if (!submissionKey) setSubmissionKey(key);
    const submitted = { ...form, submittedAt: new Date().toISOString() };
    finalizingRef.current = true;
    setFinalizing(true);
    setNotice("Saving your reviewed listing...");
    try {
      const result = await finalizeIntake(submitted, key);
      saveIntake(submitted);
      saveSubmittedIntakeContext(result);
      setSubmissionKey(undefined);
      submissionKeyRef.current = undefined;
      changeStep(2);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "We couldn't save this listing. Please try again.");
    } finally {
      finalizingRef.current = false;
      setFinalizing(false);
    }
  }
  function status(key: keyof VehicleIntake) {
    const value = form[key];
    const missing =
      value === null ||
      value === "" ||
      value === "unknown" ||
      value === undefined;
    return (
      <span
        className={`field-status ${missing ? "missing" : found.includes(key) ? "found" : "confirm"}`}
      >
        {uncertain.includes(key) && missing
          ? "Needs confirmation"
          : missing
            ? "Missing"
            : found.includes(key)
              ? "Found"
              : "Needs confirmation"}
      </span>
    );
  }
  function field(
    key:
      | "year"
      | "make"
      | "model"
      | "trim"
      | "mileageKm"
      | "askingPriceCad"
      | "city"
      | "vin"
      | "listingTitle"
      | "sellerName"
      | "location"
      | "transmission"
      | "drivetrain"
      | "engine"
      | "priceCurrency",
    label: string,
    numeric = false,
  ) {
    return (
      <div className="review-field" key={key}>
        <label htmlFor={key}>
          <span>
            {label}
            {["make", "model"].includes(key) ? " *" : ""}
          </span>
          {status(key)}
        </label>
        <input
          id={key}
          name={key}
          value={form[key] ?? ""}
          type={numeric ? "number" : "text"}
          inputMode={numeric ? "numeric" : "text"}
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
          maxLength={key === "vin" ? 17 : 100}
          placeholder={
            numeric ? "Unknown" : key === "vin" ? "Not provided" : ""
          }
          onChange={(e) =>
            update(
              key,
              numeric
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
              : key === "vin"
                ? e.target.value.toUpperCase()
                : e.target.value,
            )
          }
        />
        {errors[key] && (
          <small className="field-error" id={`${key}-error`}>
            {errors[key]}
          </small>
        )}
      </div>
    );
  }
  function select(
    key:
      | "sellerType"
      | "accidentHistoryMentioned"
      | "rebuiltStatus"
      | "carfaxStatus"
      | "inspectionAllowed"
      | "maintenanceRecords",
    label: string,
    options: [string, string][],
  ) {
    return (
      <div className="review-field" key={key}>
        <label htmlFor={key}>
          <span>{label}</span>
          {status(key)}
        </label>
        <select
          id={key}
          value={form[key]}
          onChange={(e) =>
            update(key, e.target.value as VehicleIntake[typeof key])
          }
        >
          <option value="unknown">Unknown / not stated</option>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (!ready) return <p role="status">Preparing your listing...</p>;
  return (
    <div className="intake-shell">
      <ProgressSteps current={step} />
      <div className="flow-layout">
        <div className="flow-main">
          <div className="form-head">
            <p className="eyebrow">
              {step === 0
                ? "Start with the ad"
                : step === 1
                  ? "Vehicle review"
                  : "Your next step"}
            </p>
            <h1 ref={heading} tabIndex={-1}>
              {step === 0
                ? "Add the car listing"
                : step === 1
                  ? "Here's what we found"
                  : "Choose your buyer report"}
            </h1>
            <p>
              {step === 0
                ? "Paste the ad text to extract the details we can. Add a link or screenshots for reference, or enter details yourself."
                : step === 1
                  ? "Confirm the details before we analyze the listing. Seller statements are claims, not verified facts."
                  : vehicleTitle(form)}
            </p>
          </div>
          {!storageOk && (
            <p className="notice" role="status">
              Your browser cannot save this draft across refreshes. Keep this
              tab open to continue.
            </p>
          )}
          {!!Object.keys(errors).length && (
            <div className="form-errors" role="alert">
              {Object.values(errors).map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {step === 0 && (
            <form onSubmit={provide} noValidate>
              <div className="input-methods" aria-label="Listing input method">
                {methods.map((m) => (
                  <button
                    type="button"
                    aria-pressed={method === m.id}
                    className={method === m.id ? "active" : ""}
                    onClick={() => {
                      setMethod(m.id);
                      setErrors({});
                    }}
                    key={m.id}
                  >
                    <m.icon size={21} aria-hidden="true" />
                    {m.label}
                  </button>
                ))}
              </div>
              {method === "text" && (
                <label>
                  Listing text
                  <textarea
                    rows={9}
                    maxLength={20000}
                    value={form.listingText}
                    onChange={(e) => update("listingText", e.target.value)}
                    placeholder="2015 Honda Civic EX, 165,000 km, $8,500. Montreal. Private seller. Carfax available. Inspection welcome..."
                  />
                  <small>
                    Include the price, mileage and seller notes. Leave out
                    unnecessary personal details.
                  </small>
                </label>
              )}
              {method === "url" && (
                <>
                  <label>
                    Listing URL
                    <input
                      type="url"
                      value={form.listingUrl}
                      onChange={(e) => update("listingUrl", e.target.value)}
                      placeholder="https://www.facebook.com/marketplace/item/..."
                    />
                  </label>
                  <p className="notice">
                    AutoCheck will securely retrieve the public listing on the
                    server and pre-fill what the page exposes. Protected pages
                    may still require pasted ad text.
                  </p>
                </>
              )}
              {method === "images" && (
                <>
                  <label className="upload-zone">
                    <ImagePlus size={32} aria-hidden="true" />
                    <span>Add listing screenshots or photos</span>
                    <small>JPG, PNG or WebP. Up to 6 files, 10 MB each.</small>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={files}
                    />
                  </label>
                  <p className="notice">
                    Image contents are not read or uploaded in this preview.
                    Only file names, sizes and types are retained. Paste the
                    text shown in the images or enter it in the review.
                  </p>
                  <div className="file-list">
                    {form.photos.map((p, i) => (
                      <div key={`${p.name}-${i}`}>
                        <span>
                          {p.name}
                          <small>{formatFileSize(p.size)}</small>
                        </span>
                        <button
                          className="icon-button"
                          type="button"
                          title={`Remove ${p.name}`}
                          aria-label={`Remove ${p.name}`}
                          onClick={() =>
                            update(
                              "photos",
                              form.photos.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {method === "manual" && (
                <div className="manual-note">
                  <PenLine size={28} aria-hidden="true" />
                  <h2>No ad text available?</h2>
                  <p>
                    Enter what you know about the car. Anything you leave
                    unknown becomes a question to ask the seller.
                  </p>
                </div>
              )}
              {form.listingUrl && method !== "url" && (
                <p className="saved-link">
                  <Link2 size={16} aria-hidden="true" />
                  Saved link: <span>{form.listingUrl}</span>
                </p>
              )}
              <div className="form-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={urlStatus === "retrieving"}
                >
                  {method === "manual" ||
                  (method === "images" && !form.listingText)
                    ? "Review Vehicle Details"
                    : method === "url" && !form.listingText
                      ? urlStatus === "retrieving"
                        ? "Reading listing..."
                        : "Read Listing"
                      : "Extract Vehicle Details"}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
            </form>
          )}
          {step === 1 && (
            <form onSubmit={review} noValidate>
              <p className="notice">
                {found.length
                  ? `${found.length} fields found in the ad. `
                  : "No vehicle details were extracted. "}
                Missing details may stay unknown. Make and model are required to
                identify the vehicle.
              </p>
              <fieldset>
                <legend>01 / Vehicle identity</legend>
                <div className="form-grid">
                  {field("make", "Make")}
                  {field("model", "Model")}
                  {field("year", "Year", true)}
                  {field("trim", "Trim")}
                </div>
              </fieldset>
              <fieldset>
                <legend>02 / The listing</legend>
                <div className="form-grid">
                  {field("mileageKm", "Mileage (km)", true)}
                  {field("askingPriceCad", "Asking price (CAD)", true)}
                  {field("priceCurrency", "Price currency")}
                  {field("city", "City")}
                  {field("location", "Listing location")}
                  {field("vin", "VIN")}
                </div>
              </fieldset>
              <fieldset>
                <legend>03 / Source details</legend>
                <div className="form-grid">
                  {field("listingTitle", "Listing title")}
                  {field("sellerName", "Seller / dealer")}
                  {field("transmission", "Transmission")}
                  {field("drivetrain", "Drivetrain")}
                  {field("engine", "Engine")}
                </div>
              </fieldset>
              <fieldset>
                <legend>04 / Seller claims</legend>
                <div className="form-grid">
                  {select("sellerType", "Seller type", [
                    ["private", "Private seller"],
                    ["dealer", "Dealer"],
                  ])}
                  {select("carfaxStatus", "Carfax", [
                    ["available", "Seller says available"],
                    ["not_available", "Not available"],
                  ])}
                  {select("accidentHistoryMentioned", "Accident history", [
                    ["yes", "Accident reported"],
                    ["no", "Seller says no accidents"],
                  ])}
                  {select("rebuiltStatus", "Rebuilt / salvage status", [
                    ["yes", "Rebuilt or salvage reported"],
                    ["no", "Seller says not rebuilt / salvage"],
                  ])}
                  {select("inspectionAllowed", "Independent inspection", [
                    ["yes", "Allowed"],
                    ["no", "Refused"],
                  ])}
                  {select("maintenanceRecords", "Maintenance records", [
                    ["yes", "Seller says available"],
                    ["no", "Not available"],
                  ])}
                </div>
              </fieldset>
              <label>
                Notes or concerns (optional)
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={form.sellerDescription}
                  onChange={(e) => update("sellerDescription", e.target.value)}
                />
                <small>
                  Notes are retained for your reference. Only the confirmed
                  fields above affect this preview report.
                </small>
              </label>
              <div className="form-actions between">
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => changeStep(0)}
                >
                  <ArrowLeft size={18} />
                  Back
                </button>
                <button className="button button-primary" type="submit" disabled={finalizing}>
                  {finalizing ? "Saving reviewed listing..." : "Confirm & Continue"}
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          )}
          {step === 2 && (
            <>
              <PricingCards
                onSelect={(type) => {
                  saveIntake({
                    ...form,
                    submittedAt: new Date().toISOString(),
                  });
                  saveReportType(type);
                  router.push(`/report?type=${type}`);
                }}
              />
              <p className="fine-print">
                Full report opens as a preview. No payment or card details are
                collected.
              </p>
              <button
                className="button button-ghost"
                type="button"
                onClick={() => changeStep(1)}
              >
                <ArrowLeft size={18} />
                Back to Vehicle
              </button>
            </>
          )}
        </div>
        <aside className="flow-sidebar">
          <ShieldCheck size={28} aria-hidden="true" />
          <h2>A clearer picture before you commit.</h2>
          <p>
            Start with what the seller shared. Keep the unknowns visible. Verify
            before buying.
          </p>
          <hr />
          <h3>Your listing, your control</h3>
          <p>No account required. Your draft stays on this device.</p>
          <a href="/example-report" className="text-link">
            See an example report <ArrowRight size={16} />
          </a>
        </aside>
      </div>
    </div>
  );
}
