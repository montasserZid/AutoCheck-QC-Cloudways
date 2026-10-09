import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { ClearDataButton } from "@/components/ClearDataButton";
export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How the AutoCheck QC preview handles your information and how to delete saved data.",
};
export default function PrivacyPage() {
  return (
    <main className="page-shell">
      <Container className="narrow">
        <div className="page-heading">
          <p className="eyebrow">Privacy</p>
          <h1>
            Your information. <br />
            Within your control.
          </h1>
          <p>This notice describes the current preview experience.</p>
        </div>
        <div className="policy-content">
          <section>
            <h2>What is saved</h2>
            <p>
              Listing text, links, confirmed vehicle details, reports and form
              drafts are saved in this browser. Inspection requests may include
              the name, phone, email and location you enter. Contact messages,
              including your name and email, are stored by AutoCheck QC for
              support follow-up. Selected images retain only file names, sizes
              and types; image contents are not uploaded.
            </p>
          </section>
          <section>
            <h2>Where it goes</h2>
            <p>
              The contact form sends its fields to AutoCheck QC. Listing links
              are sent to the extraction service, and reviewed intake details
              are submitted to AutoCheck to save the listing and support the
              Free Quick Check. Full report previews and inspection requests
              remain local; no request is sent to an inspector or payment
              service. Anyone with access to this browser profile may be able to
              see its locally saved information.
            </p>
          </section>
          <section>
            <h2>Keep personal information to a minimum</h2>
            <p>
              Do not enter identity documents, card details or unnecessary
              seller information. Avoid using a shared browser for sensitive
              information. Information saved here remains until you delete it or
              clear the browser&apos;s site data.
            </p>
          </section>
          <section>
            <h2>Delete your saved information</h2>
            <p>
              This removes AutoCheck QC listings, reports, inspection drafts and
              older locally saved contact messages from this browser. It does
              not delete intake details or contact messages already submitted to
              AutoCheck QC; use the Privacy / data deletion contact topic for
              that request. Close other AutoCheck QC tabs first so they do not
              save an open draft again.
            </p>
            <ClearDataButton />
          </section>
          <section>
            <h2>External resources</h2>
            <p>
              Official resource links take you to separate websites with their
              own privacy practices. They are not searches performed on your
              behalf.
            </p>
          </section>
        </div>
      </Container>
    </main>
  );
}
