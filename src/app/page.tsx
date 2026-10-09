import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CarFront,
  FileSearch,
  MessageSquareText,
  MapPin,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Container } from "@/components/Container";
import { VehicleIntakeFlow } from "@/components/VehicleIntakeFlow";
import { PricingCards } from "@/components/PricingCards";
import { faqItems } from "@/content/faq";
import { officialSources } from "@/content/site";
import { VehicleDrawing } from "@/components/dossier/VehicleDrawing";
import dossier from "@/components/dossier/dossier.module.css";

export default function Home() {
  return (
    <main className="decision-desk">
      <section className={`${dossier.proof} ${dossier.hero}`} aria-labelledby="desk-title">
        <div className={dossier.heroInner}>
          <div className={dossier.heroRegister}><span>THE BUYER’S VEHICLE DOSSIER</span><span>INDEPENDENT THINKING / QUÉBEC</span></div>
          <div className={dossier.heroGrid}>
          <div className={dossier.heroIntro}>
            <h1 id="desk-title">
              A used car.<br />A clearer picture.<br /><span>Your next move.</span>
            </h1>
            <p className={dossier.lead}>
              Start with the listing. Bring the facts, the unknowns and the right questions into focus—before paying for an inspection.
            </p>
            <p className={dossier.boundary}>
              Supports a professional inspection. Never replaces one.
            </p>
            <figure className={dossier.drawing}><VehicleDrawing /><figcaption className={dossier.drawingCaption}><span>LOOK CLOSER. ASK BETTER.</span><span>ILLUSTRATIVE VEHICLE</span></figcaption></figure>
          </div>
          <div id="start-check">
            <VehicleIntakeFlow landing />
          </div>
          </div>
          <div className={dossier.heroBottom}>
            <p><strong><span>01</span>The listing, organized.</strong>Vehicle details with their source intact.</p>
            <p><strong><span>02</span>The unknowns, visible.</strong>Seller claims stay claims. Gaps stay honest.</p>
            <p><strong><span>03</span>The next step, clearer.</strong>Supports a professional inspection. Never replaces one.</p>
          </div>
        </div>
      </section>
      <section className="desk-source-band" aria-label="Listing sources">
        <Container>
          <span>Bring the ad you already have</span>
          <p>
            Facebook Marketplace <span>·</span> Kijiji <span>·</span> AutoTrader{" "}
            <span>·</span> Private sellers & dealers
          </p>
          <small>
            Listing sources, not partners. Protected listings may need pasted
            text.
          </small>
        </Container>
      </section>
      <section className="desk-section">
        <Container>
          <div className="desk-section-head">
            <p className="eyebrow">From uncertainty to a next step</p>
            <h2>Three questions. A better starting point.</h2>
          </div>
          <div className="desk-principles">
            {[
              {
                icon: CarFront,
                n: "01",
                title: "What do we know?",
                text: "Bring the vehicle details together. Review what the ad says and correct anything that looks off.",
              },
              {
                icon: FileSearch,
                n: "02",
                title: "What’s unresolved?",
                text: "Keep missing information and seller claims visible. Know which questions still need an answer.",
              },
              {
                icon: Wrench,
                n: "03",
                title: "What should I do next?",
                text: "Choose your report. Use its guidance to decide what to ask, verify or bring to a professional inspector.",
              },
            ].map(({ icon: Icon, n, title, text }) => (
              <article key={n}>
                <div>
                  <Icon size={24} aria-hidden="true" />
                  <span>{n}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </Container>
      </section>
      <section className="desk-section desk-example">
        <Container className="desk-example-grid">
          <div>
            <p className="eyebrow">See the decision path</p>
            <h2>
              Know what to ask.
              <br />
              Before you go.
            </h2>
            <p>
              A listing can look promising and still leave important questions.
              Our full report preview turns those gaps into practical next
              steps.
            </p>
            <Link className="text-link" href="/example-report">
              Explore the example report <ArrowUpRight size={17} />
            </Link>
          </div>
          <article className="desk-example-card">
            <div className="desk-example-top">
              <span>ILLUSTRATIVE EXAMPLE</span>
              <CarFront size={22} aria-hidden="true" />
            </div>
            <h3>2017 Mazda3 GS</h3>
            <p>168,000 km · $8,900 CAD · Laval</p>
            <div className="desk-example-decision">
              <span className="desk-state">Questions to resolve</span>
              <h4>Ask more questions</h4>
              <p>
                Inspection is welcome. VIN and service history still need
                confirmation.
              </p>
            </div>
            <div className="desk-example-question">
              <MessageSquareText size={21} aria-hidden="true" />
              <div>
                <strong>Start with the seller</strong>
                <p>
                  “Could you send the complete VIN and a current vehicle history
                  report?”
                </p>
              </div>
            </div>
          </article>
        </Container>
      </section>
      <section className="desk-section">
        <Container>
          <div className="desk-section-head">
            <p className="eyebrow">Choose after reviewing your vehicle</p>
            <h2>The right level of detail for your next step.</h2>
            <p>
              The Free Quick Check shows available historical model-year
              information. The Full Buyer Report is a rules-based preview with
              listing concerns and a buyer checklist.
            </p>
          </div>
          <PricingCards />
          <p className="fine-print">
            Planned prices in Canadian dollars. Full reports open as previews
            with no charge.
          </p>
        </Container>
      </section>
      <section className="desk-section desk-local">
        <Container className="desk-example-grid">
          <div>
            <p className="eyebrow">
              <MapPin size={15} aria-hidden="true" /> Quebec context
            </p>
            <h2>
              A little preparation.
              <br />A more informed visit.
            </h2>
            <p>
              From Montreal to Laval, Longueuil and beyond: ask about rust,
              request service records, and leave the mechanical assessment to a
              qualified professional.
            </p>
            <Link className="text-link" href="/inspection">
              Prepare an inspection request <ArrowRight size={17} />
            </Link>
          </div>
          <div className="desk-boundaries">
            <ShieldCheck size={26} aria-hidden="true" />
            <h3>Clear about what we can tell you.</h3>
            <p>
              Seller statements remain claims. AutoCheck does not independently
              check actual condition, market value, Carfax, RDPRM or SAAQ
              results.
            </p>
            <p>
              Use official resources and an independent inspection before
              buying.
            </p>
            <div className="resource-links">
              {officialSources.map((source) => (
                <a
                  key={source.href}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.label}
                  <ArrowUpRight size={15} />
                </a>
              ))}
            </div>
          </div>
        </Container>
      </section>
      <section className="desk-section">
        <Container className="desk-example-grid">
          <div>
            <p className="eyebrow">Before you start</p>
            <h2>A few good questions.</h2>
            <Link className="text-link" href="/faq">
              Read all FAQs <ArrowRight size={17} />
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
      <section className="desk-bottom">
        <Container>
          <div>
            <p className="eyebrow">Start with the car in front of you</p>
            <h2>You don’t need every answer yet.</h2>
          </div>
          <a className="button button-primary" href="#start-check">
            Add your listing <ArrowRight size={18} />
          </a>
        </Container>
      </section>
    </main>
  );
}
