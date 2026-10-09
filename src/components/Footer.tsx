import Link from "next/link";
import { officialSources, siteConfig } from "@/content/site";
import { Container } from "./Container";

export function Footer() {
  return (
    <footer className="site-footer">
      <Container className="footer-grid">
        <div>
          <p className="eyebrow">The buyer’s vehicle dossier</p>
          <h2>Know more. Buy better.</h2>
          <p>AutoCheck QC · Made for the questions before the keys.</p>
          <p className="fine-print">{siteConfig.disclaimer}</p>
        </div>
        <div>
          <h3>Product</h3>
          <Link href="/check">Check a Car</Link>
          <Link href="/inspection">Prepare an Inspection</Link>
          <Link href="/example-report">Example Report</Link>
          <Link href="/pricing">Pricing</Link>
        </div>
        <div>
          <h3>Company</h3>
          <Link href="/faq">FAQ</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </div>
        <div>
          <h3>Official buyer resources</h3>
          {officialSources.map((source) => (
            <a
              key={source.href}
              href={source.href}
              target="_blank"
              rel="noreferrer"
            >
              {source.label}
            </a>
          ))}
        </div>
      </Container>
      <Container className="footer-bottom">
        <span>AutoCheck QC / Built for Quebec buyers</span>
        <span>
          Preview environment - payments and live report delivery are not
          enabled.
        </span>
      </Container>
    </footer>
  );
}
