import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/Container";
import { faqItems } from "@/content/faq";
export const metadata: Metadata = {
  title: "FAQ",
  description:
    "What AutoCheck QC can check, what remains unverified, and how listing reports work.",
};
export default function FaqPage() {
  return (
    <main className="page-shell">
      <Container className="narrow">
        <div className="page-heading">
          <p className="eyebrow">Frequently asked questions</p>
          <h1>
            Before you check
            <br />
            the next car.
          </h1>
          <p>
            Clear answers about reports, seller claims, inspection requests and
            your data.
          </p>
        </div>
        <div className="faq-list">
          {faqItems.map((f) => (
            <details key={f.question}>
              <summary>{f.question}</summary>
              <p>{f.answer}</p>
            </details>
          ))}
        </div>
        <div className="section-heading faq-end">
          <h2>Another question?</h2>
          <Link className="button button-secondary" href="/contact">
            Contact AutoCheck QC
          </Link>
        </div>
      </Container>
    </main>
  );
}
