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
  const groups = [
    { id: "understand", title: "Understand your report", indices: [0, 1, 2, 3, 4, 5, 13, 14] },
    { id: "listing", title: "Bring a listing", indices: [6, 7, 8, 9, 10, 17] },
    { id: "next", title: "Take the next step", indices: [11, 12, 15, 16] },
    { id: "data", title: "Payments & your data", indices: [18, 19] },
  ];
  return (
    <main className="page-shell">
      <Container className="narrow">
        <div className="page-heading">
          <p className="eyebrow">Frequently asked questions</p>
          <h1>
            Before you check <br />
            the next car.
          </h1>
          <p>
            Clear answers about reports, seller claims, inspection requests and
            your data.
          </p>
        </div>
        <div className="faq-layout">
          <nav className="faq-index" aria-label="Help topics">{groups.map(group => <a key={group.id} href={`#${group.id}`}>{group.title}</a>)}</nav>
          <div>{groups.map(group => <section className="faq-group" key={group.id} id={group.id}><h2>{group.title}</h2><div className="faq-list">
          {group.indices.map(index => faqItems[index]).filter(Boolean).map((f) => (
            <details key={f.question}>
              <summary>{f.question}</summary>
              <p>{f.answer}</p>
            </details>
          ))}</div></section>)}</div>
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
