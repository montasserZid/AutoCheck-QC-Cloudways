import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/Container";
import { ContactForm } from "@/components/ContactForm";
import { contactTopics } from "@/content/contact";
export const metadata: Metadata = {
  title: "Contact",
  description:
    "Buyer support, inspection questions and privacy requests for AutoCheck QC.",
};
export default function ContactPage() {
  return (
    <main className="page-shell">
      <Container>
        <div className="page-heading">
          <p className="eyebrow">Contact AutoCheck QC</p>
          <h1>
            Good questions deserve
            <br />
            clear answers.
          </h1>
          <p>
            For buyers, inspection professionals and anyone who needs a closer
            look.
          </p>
        </div>
        <div className="two-column contact-layout">
          <div className="contact-topics">
            {contactTopics.map((t, i) => (
              <section key={t}>
                <span>0{i + 1}</span>
                <div>
                  <h2>{t}</h2>
                  <p>
                    {
                      [
                        "Questions about a listing, your report or its limitations.",
                        "Vehicle location, preferred timing and request details.",
                        "For independent inspection professionals in the Montreal area. No partner enrolment is active.",
                        "Review how information is saved and remove it from this browser.",
                        "Product questions and other inquiries.",
                      ][i]
                    }
                  </p>
                  {i === 3 && (
                    <Link className="text-link" href="/privacy">
                      Privacy and deletion controls
                    </Link>
                  )}
                </div>
              </section>
            ))}
          </div>
          <ContactForm />
        </div>
      </Container>
    </main>
  );
}
