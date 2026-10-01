import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { reportDisclaimer } from "@/lib/reportEngine";
export const metadata: Metadata = {
  title: "Terms and Limitations",
  description:
    "Limits of AutoCheck QC listing pre-screening and preview services.",
};
export default function TermsPage() {
  return (
    <main className="page-shell">
      <Container className="narrow">
        <div className="page-heading">
          <p className="eyebrow">Terms and limitations</p>
          <h1>
            A clearer starting point.
            <br />
            Not a guarantee.
          </h1>
        </div>
        <div className="policy-content">
          <section>
            <h2>Use of the report</h2>
            <p>{reportDisclaimer}</p>
          </section>
          <section>
            <h2>Information and accuracy</h2>
            <p>
              Review and correct extracted details before generating a report.
              Reports use the fields you confirm and general inspection
              guidance. Scores are illustrative concern indicators, not
              probabilities, valuations or mechanical diagnoses. No Carfax,
              RDPRM, SAAQ or other history search is performed.
            </p>
          </section>
          <section>
            <h2>Preview services</h2>
            <p>
              No payment is collected. Prices describe planned services. Full
              reports can be viewed, but human review and live inspection
              booking are not available. Saved inspection requests and contact
              messages are not transmitted, and do not reserve appointments or
              trigger follow-up.
            </p>
          </section>
          <section>
            <h2>Your purchase decision</h2>
            <p>
              Verify seller identity, vehicle documents and actual condition
              independently. Obtain appropriate professional guidance for
              mechanical, legal, registration, insurance or financial questions.
              Use official Quebec resources for current requirements.
            </p>
          </section>
        </div>
      </Container>
    </main>
  );
}
