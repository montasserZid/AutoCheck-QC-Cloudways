"use client";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Link2,
  ImagePlus,
  PenLine,
  ShieldCheck,
  CarFront,
  LoaderCircle,
} from "lucide-react";
import type { VehicleIntake } from "@/types/domain";
import { emptyIntake, extractListing } from "@/lib/listingExtraction";
import { extractListingUrl } from "@/lib/listingUrlClient";
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
import { DossierIntake } from "./dossier/DossierIntake";
import { VehicleReviewEvidence } from "./dossier/VehicleReviewEvidence";
import { VehicleIdentityPlate } from "./dossier/VehicleIdentityPlate";

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
export function VehicleIntakeFlow({ landing = false }: { landing?: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<VehicleIntake>(emptyIntake);
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<Method>("url");
  const [revealed, setRevealed] = useState(false);
  const [revealVehicle, setRevealVehicle] = useState<VehicleIntake | null>(null);
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
  const leavingLanding = useRef(false);
  const Heading = landing ? "h2" : "h1";
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
    if (ready) {
      setStorageOk(
        writeLocal("intake-draft", {
          form,
          step: revealed ? 1 : step,
          method,
          found,
          uncertain,
          submissionKey,
        }),
      );
      // Persist the same draft before handing off from the landing to /check.
      if (landing && step > 0 && leavingLanding.current) router.push("/check");
    }
  }, [
    form,
    step,
    method,
    found,
    uncertain,
    submissionKey,
    ready,
    landing,
    router,
    revealed,
  ]);
  function changeStep(next: number) {
    if (landing && next > 0) leavingLanding.current = true;
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
    if (urlStatus === "retrieving") return;
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
      setNotice("");
      const response = await extractListingUrl(listingUrl);
      setUrlStatus("idle");
      if (response.ok) {
        const extracted = response.extraction;
        setRevealVehicle({ ...emptyIntake, ...extracted.details, listingUrl: extracted.details.listingUrl ?? listingUrl });
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
        setRevealed(true);
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
        `${response.error} Paste the listing description below, or choose Manual entry.`,
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
    setRevealVehicle({ ...emptyIntake, ...result.details, listingUrl: form.listingUrl, listingSource: "Pasted listing" });
    setForm((f) => ({
      ...emptyIntake,
      listingUrl: f.listingUrl,
      listingText: f.listingText,
      photos: f.photos,
      ...result.details,
    }));
    setFound(result.found);
    setUncertain(result.uncertain);
    setNotice("");
    setRevealed(true);
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
      setNotice(
        error instanceof Error
          ? error.message
          : "We couldn't save this listing. Please try again.",
      );
    } finally {
      finalizingRef.current = false;
      setFinalizing(false);
    }
  }
  // Intake and review share the same draft and handoff contracts.
  if (step === 0)
    return <DossierIntake
      form={form} revealVehicle={revealVehicle} method={method} pending={urlStatus === "retrieving"}
      revealed={revealed} ready={ready} landing={landing} storageOk={storageOk}
      notice={notice} errors={errors} found={found}
      onMethod={(next) => { setMethod(next); setErrors({}); setNotice(""); }}
      onUpdate={update} onFiles={files} onSubmit={provide}
      onContinue={() => { setRevealed(false); changeStep(1); }}
      onBack={() => { setRevealed(false); setNotice(""); }}
    />;
  if (!ready)
    return (
      <section className="loading-panel" role="status">
        <p className="eyebrow">Your saved dossier</p><h1>Opening your listing.</h1>
        <div className="dossier-processing-rule" aria-hidden="true" />
      </section>
    );
  if (landing && step > 0)
    return (
      <div className="desk-resume">
        <CarFront size={28} aria-hidden="true" />
        <p className="eyebrow">Your saved progress</p>
        <h2>{vehicleTitle(form) || "Your vehicle review"}</h2>
        <p>
          Your details are saved on this device. Pick up where you left off.
        </p>
        <Link className="button button-primary" href="/check">
          Continue your check <ArrowRight size={18} />
        </Link>
        <Link className="text-link" href="/check?new=1">
          Start with another car
        </Link>
      </div>
    );
  return (
    <div
      className={`intake-shell dossier-review ${step === 2 ? "dossier-choice" : "phase-one"} ${landing ? "landing-intake" : ""}`}
    >
      {!landing && (
        <ProgressSteps current={step} variant={step < 2 ? "desk" : undefined} />
      )}
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
            <Heading ref={heading} tabIndex={-1}>
              {step === 0
                ? landing
                  ? "Start with the listing."
                  : "Paste the car you’re considering."
                : step === 1
                  ? "Review the listing."
                  : "Choose your buyer report"}
            </Heading>
            <p>
              {step === 0
                ? landing
                  ? "Paste the ad or a link. You’ll review the details next."
                  : "Use the listing text or a public link. You’ll review the details before choosing a report."
                : step === 1
                  ? "Check the details before continuing. Seller statements remain unverified."
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
            <p
              className={`notice ${urlStatus === "retrieving" || finalizing ? "desk-busy" : ""}`}
              role="status"
            >
              {(urlStatus === "retrieving" || finalizing) && (
                <LoaderCircle size={18} aria-hidden="true" />
              )}
              {notice}
            </p>
          )}
          {step === 1 && (
            <form onSubmit={review} noValidate>
              <p className="review-context">Make and model are required. Leave anything you don’t know blank. Open a row to edit its details.</p>
              <VehicleReviewEvidence form={form} found={found} uncertain={uncertain} errors={errors} update={update} />
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
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={finalizing}
                >
                  {finalizing
                    ? "Saving reviewed listing..."
                    : "Confirm & Continue"}
                  <ArrowRight size={18} />
                </button>
              </div>
              <p className="desk-next">
                Next: choose a Free Quick Check or Full Buyer Report preview. No
                payment is collected.
              </p>
            </form>
          )}
          {step === 2 && (
            <>
              <VehicleIdentityPlate vehicle={form} compact stateLabel="REVIEWED DETAILS · NOT VERIFIED" />
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
        {!landing && (
          <aside className="flow-sidebar">
            <VehicleIdentityPlate vehicle={form} title={!form.make && !form.model ? "Your vehicle" : undefined} compact stateLabel="YOUR LISTING · REVIEW IN PROGRESS" />
            <ShieldCheck size={28} aria-hidden="true" />
            <h2>Good decisions start with clear information.</h2>
            <p>
              Start with what the seller shared. Keep the unknowns visible.
              Verify before buying.
            </p>
            <hr />
            <ol className="desk-guidance">
              <li>
                <strong>What we know</strong>
                <span>The details you bring from the listing.</span>
              </li>
              <li>
                <strong>What’s unresolved</strong>
                <span>Missing details and claims to confirm.</span>
              </li>
              <li>
                <strong>What to do next</strong>
                <span>Choose a report, then decide what to investigate.</span>
              </li>
            </ol>
            <h3>Your listing, your control</h3>
            <p>No account required. Your draft stays on this device.</p>
            <a href="/example-report" className="text-link">
              See an example report <ArrowRight size={16} />
            </a>
          </aside>
        )}
      </div>
    </div>
  );
}
