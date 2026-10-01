import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/Container";
import { PricingCards } from "@/components/PricingCards";
export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Compare the Free Quick Check, $19.99 CAD Full Buyer Report and planned Human Review.",
};
export default function PricingPage() {
  return (
    <main className="page-shell">
      <Container>
        <div className="page-heading">
          <p className="eyebrow">A smaller step before a big purchase</p>
          <h1>
            Know what you are
            <br />
            getting into.
          </h1>
          <p>Choose the detail you need for the car you are considering.</p>
        </div>
        <PricingCards premium />
        <p className="fine-print">
          Planned prices in CAD. No payment is collected. Human review is not
          available to order.
        </p>
        <section className="section two-column">
          <div className="section-heading">
            <p className="eyebrow">Why pay for a pre-screen?</p>
            <h2>
              Your time has value.
              <br />
              So does a better question.
            </h2>
          </div>
          <div className="editorial-copy">
            <p>
              A professional inspection can cost significantly more. When
              comparing several cars, a pre-screen helps you decide which
              listing deserves your time and a full inspection.
            </p>
            <p>
              You are paying for an organized decision path: what is missing,
              what to ask, and what a professional should verify. A report does
              not guarantee a good car or replace inspection.
            </p>
            <Link className="text-link" href="/example-report">
              See the complete example report
            </Link>
          </div>
        </section>
      </Container>
    </main>
  );
}
