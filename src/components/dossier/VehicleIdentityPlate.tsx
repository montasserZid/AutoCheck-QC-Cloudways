import type { VehicleIntake } from "@/types/domain";
import styles from "./dossier.module.css";

export function listingSourceLabel(url?: string, source?: string) {
  if (source) return source;
  if (url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Listing link"; }
  }
  return "Pasted listing";
}

/** A presentational identity object. Values remain supplied/extracted, never verified. */
export function VehicleIdentityPlate({ vehicle, pending = false, compact = false, stateLabel = "EXTRACTED · NOT VERIFIED", title }: {
  vehicle?: Partial<VehicleIntake>;
  pending?: boolean;
  compact?: boolean;
  stateLabel?: string;
  title?: string;
}) {
  const name = title || [vehicle?.make, vehicle?.model].filter(Boolean).join(" ");
  const number = new Intl.NumberFormat("en-CA");
  return (
    <section className={`${styles.proof} ${styles.plate} ${compact ? "identity-compact" : ""} ${pending ? styles.pendingPlate : styles.assembled}`} aria-label="Vehicle identity">
      <div className={styles.plateMeta}>
        <span>VEHICLE DOSSIER</span>
        <span>{pending ? "AWAITING LISTING DETAILS" : stateLabel}</span>
      </div>
      {pending ? (
        <div className={styles.skeleton} aria-hidden="true">
          <span /><span /><span />
          <div><span /><span /></div>
        </div>
      ) : (
        <>
          <div className={styles.plateIdentity}>
            {vehicle?.year != null && <span className={styles.plateYear}>{vehicle.year}</span>}
            <h3>{name || "Vehicle details not found"}</h3>
            {vehicle?.trim && <p className={styles.plateTrim}>{vehicle.trim}</p>}
          </div>
          {(vehicle?.mileageKm != null || vehicle?.askingPriceCad != null) && (
            <dl className={styles.plateFacts}>
              {vehicle?.mileageKm != null && <div><dt>Listed mileage</dt><dd>{number.format(vehicle.mileageKm)} <span>km</span></dd></div>}
              {vehicle?.askingPriceCad != null && <div><dt>Asking price</dt><dd>${number.format(vehicle.askingPriceCad)} <span>{vehicle.priceCurrency || "CAD"}</span></dd></div>}
            </dl>
          )}
          <dl className={styles.plateSource}>
            {(vehicle?.listingSource || vehicle?.listingUrl || stateLabel === "EXTRACTED · NOT VERIFIED") && <div><dt>Source</dt><dd>{listingSourceLabel(vehicle?.listingUrl, vehicle?.listingSource)}</dd></div>}
            {vehicle?.vin && <div><dt>VIN · supplied</dt><dd className={styles.vin}>{vehicle.vin}</dd></div>}
          </dl>
        </>
      )}
    </section>
  );
}
