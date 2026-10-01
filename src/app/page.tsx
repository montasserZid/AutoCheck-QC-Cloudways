import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  Search,
  MessageSquareText,
  Wrench,
  FileSearch,
  MapPin,
  Check,
} from "lucide-react";
import { Container } from "@/components/Container";
import { PricingCards } from "@/components/PricingCards";
import { faqItems } from "@/content/faq";
import { officialSources } from "@/content/site";
export default function Home() {
  return (
    <main>
      <section className="hero">
        <Container className="hero-content">
          <p className="eyebrow">
            <MapPin size={15} aria-hidden="true" />
            Built for Quebec used-car buyers
          </p>
          <h1>
            Don&apos;t buy a<br />
            used car blind.
          </h1>
          <p className="hero-description">
            The ad tells one story.
            <br />
            <strong>Know what to ask next.</strong>
          </p>
          <p className="hero-support">
            Paste the listing text. AutoCheck QC helps you spot red flags,
            missing details and whether the car deserves a professional
            inspection.
          </p>
          <div className="button-row">
            <Link className="button button-primary" href="/check">
              Check This Car
              <ArrowUpRight size={20} />
            </Link>
            <Link className="button button-outline" href="/inspection">
              Book a Mobile Inspection
            </Link>
          </div>
          <Link className="hero-example" href="/example-report">
            See Example Report
            <ArrowRight size={17} />
          </Link>
          <div className="hero-trust">
            <ShieldCheck size={17} />
            <span>Pre-screen first. Inspect before buying.</span>
          </div>
        </Container>
        <span className="hero-caption">
          AUTOCHECK QC / MONTREAL & SURROUNDING AREAS
        </span>
      </section>
      <section className="platform-band">
        <Container>
          <p>Start with an ad from</p>
          <div>
            <span>Facebook Marketplace</span>
            <span>Kijiji</span>
            <span>AutoTrader</span>
            <span>Private sellers</span>
            <span>Dealers</span>
          </div>
          <small>
            Paste the ad text. Listing sources shown for reference, not as
            partners.
          </small>
        </Container>
      </section>
      <section className="section">
        <Container>
          <div className="section-heading">
            <p className="eyebrow">01 / A better starting point</p>
            <h2>
              From a listing to
              <br />a clearer next step.
            </h2>
            <p>
              Before the drive across town. Before the deposit. Before you
              commit.
            </p>
          </div>
          <div className="process-grid">
            {[
              {
                icon: FileSearch,
                title: "Give us the ad",
                body: "Paste the listing text. Review the details we find and confirm anything missing.",
              },
              {
                icon: Search,
                title: "See what needs a closer look",
                body: "Get listing concerns, document gaps and practical questions for the seller.",
              },
              {
                icon: Wrench,
                title: "Decide what comes next",
                body: "Ask more questions, move on, or take the next step with an independent inspection.",
              },
            ].map((s, i) => (
              <article className="process-card" key={s.title}>
                <div>
                  <s.icon size={28} />
                  <span>0{i + 1}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>
      <section className="section band">
        <Container className="two-column">
          <div className="section-heading">
            <p className="eyebrow">02 / Look beyond the photos</p>
            <h2>
              A shiny car can still
              <br />
              leave big questions.
            </h2>
            <p>
              AutoCheck QC turns scattered ad details into the checks that
              matter before your first visit.
            </p>
            <Link className="text-link" href="/check">
              Check the listing in front of you
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="check-rows">
            {[
              [
                "Listing red flags",
                "Inspection refusal, reported damage and unanswered questions.",
              ],
              [
                "Missing documents",
                "VIN, history, maintenance and rebuilt-status information.",
              ],
              [
                "Model verification checklist",
                "Areas to check for the model, its mileage and Quebec conditions.",
              ],
              [
                "A practical decision path",
                "Seller questions, negotiation points and an inspection recommendation.",
              ],
            ].map(([h, p]) => (
              <div key={h}>
                <Check size={20} />
                <div>
                  <h3>{h}</h3>
                  <p>{p}</p>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>
      <section className="section">
        <Container className="two-column example-section">
          <div className="section-heading">
            <p className="eyebrow">03 / See what you get</p>
            <h2>
              More than a score.
              <br />A plan for the seller.
            </h2>
            <p>
              A believable listing. Real questions to resolve. Explore the full
              example before checking your own car.
            </p>
            <Link className="button button-secondary" href="/example-report">
              Explore the Example Report
              <ArrowUpRight size={18} />
            </Link>
          </div>
          <article className="report-preview">
            <div className="preview-top">
              <span>
                <ShieldCheck size={18} />
                AUTOCHECK QC
              </span>
              <span>EXAMPLE</span>
            </div>
            <h3>2017 Mazda3 GS</h3>
            <p>
              168,000 km <span>/</span> $8,900 CAD <span>/</span> Laval
            </p>
            <div className="preview-decision">
              <span className="badge medium">Medium listing risk</span>
              <h4>Ask more questions</h4>
              <p>
                Inspection is welcome. VIN and service history still need
                confirmation.
              </p>
            </div>
            <div className="preview-question">
              <MessageSquareText size={22} />
              <div>
                <strong>Your first question</strong>
                <p>
                  Could you send the complete VIN and a current vehicle history
                  report?
                </p>
              </div>
            </div>
            <Link className="text-link" href="/example-report">
              Read the full decision path
              <ArrowRight size={16} />
            </Link>
          </article>
        </Container>
      </section>
      <section className="section band">
        <Container>
          <div className="section-heading">
            <p className="eyebrow">04 / Choose your level of detail</p>
            <h2>
              Start free. Look closer
              <br />
              when the car looks promising.
            </h2>
          </div>
          <PricingCards />
          <p className="fine-print">
            Planned prices in Canadian dollars. Full reports open as previews
            with no charge.
          </p>
        </Container>
      </section>
      <section className="section">
        <Container className="two-column">
          <div className="section-heading">
            <p className="eyebrow">Spend your attention wisely</p>
            <h2>
              Inspect the right car.
              <br />
              Not every car.
            </h2>
          </div>
          <div className="editorial-copy">
            <p>
              A professional inspection can cost significantly more than a
              listing pre-screen. When you are comparing several cars, start by
              finding out which seller can answer the important questions.
            </p>
            <p>
              Resolve missing documents and inspection permission first. Then
              bring a focused checklist to the professional who will assess the
              actual vehicle.
            </p>
            <p className="inline-note">
              <ShieldCheck size={20} />A pre-screen never replaces a mechanical
              inspection.
            </p>
          </div>
        </Container>
      </section>
      <section className="section quebec-band">
        <Container>
          <div className="section-heading">
            <p className="eyebrow">Built around buying in Quebec</p>
            <h2>
              Local context.
              <br />
              Independent verification.
            </h2>
            <p>
              Montreal, Laval, Longueuil, Brossard and the surrounding areas.
            </p>
          </div>
          <div className="resource-grid">
            <article>
              <MapPin size={25} />
              <h3>Look underneath</h3>
              <p>
                Ask for a proper rust assessment of the underbody, brake lines
                and suspension mounts. Exterior photos are only part of the
                picture.
              </p>
            </article>
            <article>
              <FileSearch size={25} />
              <h3>Check the documents</h3>
              <p>
                Use official resources for vehicle transfer, purchase guidance
                and the checks applicable to your situation.
              </p>
              <div className="resource-links">
                {officialSources.map((s) => (
                  <a
                    key={s.href}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.label}
                    <ArrowUpRight size={15} />
                  </a>
                ))}
              </div>
            </article>
            <article>
              <ShieldCheck size={25} />
              <h3>Verify seller claims</h3>
              <p>
                A mention of Carfax is not a history check. AutoCheck QC does
                not retrieve Carfax, RDPRM or SAAQ results.
              </p>
            </article>
          </div>
        </Container>
      </section>
      <section className="section inspection-cta">
        <Container>
          <div>
            <p className="eyebrow">The next step, when you are ready</p>
            <h2>
              Put an independent
              <br />
              inspection on your checklist.
            </h2>
            <p>
              Prepare the vehicle, location and preferred time in one request.
            </p>
          </div>
          <Link className="button button-primary" href="/inspection">
            Book a Mobile Inspection
            <ArrowUpRight size={19} />
          </Link>
        </Container>
      </section>
      <section className="section">
        <Container className="two-column">
          <div className="section-heading">
            <p className="eyebrow">Good questions</p>
            <h2>
              Know what the
              <br />
              report can tell you.
            </h2>
            <Link className="text-link" href="/faq">
              All questions
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="faq-list">
            {[faqItems[1], faqItems[2], faqItems[6], faqItems[3]].map((f) => (
              <details key={f.question}>
                <summary>{f.question}</summary>
                <p>{f.answer}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>
      <section className="section final-cta">
        <Container>
          <p className="eyebrow">AUTOCHECK QC</p>
          <h2>
            The next car you check
            <br />
            could be the one.
          </h2>
          <p>Start with the listing. Keep your questions in front of you.</p>
          <Link className="button button-primary" href="/check">
            Check This Car
            <ArrowUpRight size={20} />
          </Link>
        </Container>
      </section>
    </main>
  );
}
