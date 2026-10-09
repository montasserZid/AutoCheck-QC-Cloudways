"use client";

import { useEffect, useLayoutEffect, useRef, type ChangeEvent, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, FileText, Link2, ImagePlus, PenLine, X } from "lucide-react";
import type { VehicleIntake } from "@/types/domain";
import { formatFileSize } from "@/lib/format";
import { VehicleIdentityPlate, listingSourceLabel } from "./VehicleIdentityPlate";
import styles from "./dossier.module.css";

export type IntakeMethod = "text" | "url" | "images" | "manual";

interface Props {
  form: VehicleIntake;
  revealVehicle: VehicleIntake | null;
  method: IntakeMethod;
  pending: boolean;
  revealed: boolean;
  ready: boolean;
  landing: boolean;
  storageOk: boolean;
  notice: string;
  errors: Record<string, string>;
  found: string[];
  onMethod: (method: IntakeMethod) => void;
  onUpdate: <K extends keyof VehicleIntake>(key: K, value: VehicleIntake[K]) => void;
  onFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent) => void;
  onContinue: () => void;
  onBack: () => void;
}

export function DossierIntake(props: Props) {
  const { form, revealVehicle, method, pending, revealed, ready, landing, storageOk, notice, errors, found,
    onMethod, onUpdate, onFiles, onSubmit, onContinue, onBack } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const previousSize = useRef<{ height: number; width: number } | null>(null);
  const transition = useRef<Animation | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const url = useRef<HTMLInputElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const recovery = Boolean(notice) && !pending && !revealed;
  const H = landing ? "h2" : "h1";
  const identity = revealVehicle ?? form;
  // Animate only the measured surface change. The content and next action are
  // available immediately; there is no artificial processing delay.
  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    const from = transition.current ? node.getBoundingClientRect().height : previousSize.current?.height;
    transition.current?.cancel();
    const size = node.getBoundingClientRect();
    if (from && previousSize.current?.width === size.width && Math.abs(from - size.height) > 2 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      transition.current = node.animate([{ height: `${from}px` }, { height: `${size.height}px` }], { duration: 280, easing: "cubic-bezier(.22, 1, .36, 1)" });
    }
    previousSize.current = { height: size.height, width: size.width };
  }, [method, pending, revealed, notice, ready, errors]);
  useEffect(() => () => transition.current?.cancel(), []);
  useEffect(() => {
    if (revealed || pending) {
      heading.current?.focus({ preventScroll: true });
      if (landing && window.matchMedia("(max-width: 680px)").matches) {
        surface.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }
    }
  }, [revealed, pending, landing]);
  useEffect(() => {
    if (Object.keys(errors).length) {
      const target = errors.listingUrl ? url.current : errors.listingText ? text.current : errorSummary.current;
      target?.focus({ preventScroll: true });
    }
  }, [errors]);
  useEffect(() => {
    if (recovery) text.current?.focus({ preventScroll: true });
  }, [recovery]);

  return (
    <div ref={surface} className={`${styles.proof} ${styles.intake} ${landing ? "" : styles.standalone}`} data-dossier-state={revealed ? "revealed" : pending ? "pending" : recovery ? "recovery" : "input"}>
      <div className={styles.intakeRegister}><span>AUTOCHECK / QC</span><span>01 — THE LISTING</span></div>
      <div className={styles.intakeHeading}>
        <H ref={heading} tabIndex={-1}>
          {revealed ? (identity.make || identity.model ? "There’s your vehicle." : "Let’s fill in the picture.") : pending ? "Reading the listing." : recovery ? "Let’s try the listing text." : "Start with the listing."}
        </H>
        <p>{revealed ? "Here’s what the listing tells us. You’ll check the details next." : pending ? "Bringing the public details into one place." : recovery ? "Your link is still here. You can continue another way." : "A public link or the seller’s description is enough."}</p>
      </div>

      {!storageOk && <p className={styles.storage} role="status">This browser cannot save across refreshes. Keep this tab open to continue.</p>}

      {revealed ? (
        <div className={styles.result}>
          <VehicleIdentityPlate vehicle={identity} />
          <div className={styles.resultNote} role="status">
            <span className={styles.evidenceMark} aria-hidden="true">↳</span>
            <p>{found.length ? `${found.length} details found. ` : "No vehicle details were found. "}{notice || "Seller statements still need your confirmation. Missing details can stay unknown."}</p>
          </div>
          <button className={styles.submit} onClick={onContinue}>Review vehicle details <ArrowRight size={19} aria-hidden="true" /></button>
          <button className={styles.back} onClick={onBack}>Back to listing</button>
        </div>
      ) : pending ? (
        <div className={styles.processing}>
          <div className={styles.sourceReceipt}>
            <Link2 size={18} aria-hidden="true" />
            <div><span>{listingSourceLabel(form.listingUrl)}</span><p>{form.listingUrl}</p></div>
          </div>
          <div className={styles.scanTrack} aria-hidden="true"><span /></div>
          <div className={styles.processStatus} role="status"><span className={styles.activityDot} />Reading available public listing information</div>
          <VehicleIdentityPlate pending />
          <p className={styles.processFoot}>Some listings limit access. If this one does, you can continue with the listing text.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-busy={!ready}>
          <div className={styles.methodTabs} aria-label="Listing input method">
            {([{ id: "url", label: "Listing link", icon: Link2 }, { id: "text", label: "Ad text", icon: FileText }] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-pressed={method === id} onClick={() => onMethod(id)}><Icon size={16} aria-hidden="true" />{label}</button>
            ))}
          </div>
          {recovery && <div className={styles.recovery} role="status"><span className={styles.mono}>ANOTHER WAY FORWARD</span><p>{notice}</p></div>}
          {Object.keys(errors).length > 0 && <div className={styles.error} ref={errorSummary} role="alert" tabIndex={-1} id="dossier-errors">{Object.values(errors).map(error => <p key={error}>{error}</p>)}</div>}
          <div className={styles.methodContent} key={method}>
            {method === "url" && <div className={styles.inputGroup}>
              <label htmlFor="dossier-url">Public listing URL</label>
              <input ref={url} id="dossier-url" type="url" value={form.listingUrl || ""} aria-invalid={!!errors.listingUrl} aria-describedby={errors.listingUrl ? "dossier-errors dossier-url-help" : "dossier-url-help"} onChange={e => onUpdate("listingUrl", e.target.value)} placeholder="Paste the listing link here" autoCapitalize="none" spellCheck={false} />
              <div className={styles.inputCaption} id="dossier-url-help"><span>{form.listingUrl ? listingSourceLabel(form.listingUrl) : "Marketplace · Kijiji · AutoTrader · other public listings"}</span><ArrowUpRight size={15} aria-hidden="true" /></div>
            </div>}
            {method === "text" && <div className={styles.inputGroup}>
              <label htmlFor="dossier-text">{recovery ? "Paste listing text to continue" : "Listing text"}</label>
              <textarea ref={text} id="dossier-text" rows={4} maxLength={20000} value={form.listingText} onChange={e => onUpdate("listingText", e.target.value)} aria-invalid={!!errors.listingText} aria-describedby={errors.listingText ? "dossier-errors dossier-text-help" : "dossier-text-help"} placeholder={"2019 Honda CR-V EX · 126,400 km · $18,900\nPaste the seller’s description, price and mileage…"} />
              <div className={styles.inputCaption} id="dossier-text-help"><span>Include the price, mileage and seller notes.</span><span>{form.listingText.length ? `${form.listingText.length.toLocaleString()} / 20,000` : ""}</span></div>
            </div>}
            {method === "images" && <>
              <label className={styles.upload}><ImagePlus size={24} aria-hidden="true" /><span>Add listing screenshots or photos</span><small>JPG, PNG or WebP. Up to 6 files, 10 MB each.</small><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onFiles} aria-invalid={!!errors.photos} aria-describedby={errors.photos ? "dossier-errors" : undefined} /></label>
              <p className={styles.helper}>Image contents are not read or uploaded in this preview. Only names, sizes and types are retained. Enter the details in the review.</p>
              {form.photos.map((photo, i) => <div className={styles.file} key={`${photo.name}-${i}`}><span>{photo.name}<small>{formatFileSize(photo.size)}</small></span><button type="button" aria-label={`Remove ${photo.name}`} onClick={() => onUpdate("photos", form.photos.filter((_, j) => j !== i))}><X size={18} /></button></div>)}
            </>}
            {method === "manual" && <div className={styles.manual}><PenLine size={24} aria-hidden="true" /><h3>Start with what you know.</h3><p>Enter the vehicle details yourself. Anything unknown can become a question for the seller.</p></div>}
          </div>
          {form.listingUrl && method !== "url" && <details className={styles.retainedUrl}><summary><Link2 size={14} aria-hidden="true" />Retained link · {listingSourceLabel(form.listingUrl)}</summary><span>{form.listingUrl}</span></details>}
          <button className={styles.submit} type="submit" disabled={!ready}>{method === "manual" || (method === "images" && !form.listingText) ? "Review Vehicle Details" : method === "url" ? "Read Listing" : "Extract Vehicle Details"}<ArrowRight size={19} aria-hidden="true" /></button>
          <div className={styles.alternatives} aria-label="Other ways to add a vehicle"><button type="button" aria-pressed={method === "manual"} onClick={() => onMethod("manual")}><PenLine size={14} aria-hidden="true" />Enter manually</button><span aria-hidden="true">/</span><button type="button" aria-pressed={method === "images"} onClick={() => onMethod("images")}><ImagePlus size={15} aria-hidden="true" />Use screenshots</button></div>
          <p className={styles.privacy}>No account needed. Leave personal information out of the listing.</p>
        </form>
      )}
      <div className={styles.intakeFoot}><span className={styles.footMark}>AC</span><p>A clearer starting point.<br /><strong>Before the professional inspection.</strong></p></div>
    </div>
  );
}
