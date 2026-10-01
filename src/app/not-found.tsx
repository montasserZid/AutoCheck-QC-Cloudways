import Link from "next/link";
import { Container } from "@/components/Container";

export default function NotFound() {
  return (
    <main className="page-shell">
      <Container className="narrow">
        <section className="confirmation-panel">
          <p className="eyebrow">404</p>
          <h1>Page not found.</h1>
          <p>
            Return to AutoCheck QC and start with the car listing you want to
            review.
          </p>
          <Link className="button button-primary" href="/">
            Back Home
          </Link>
        </section>
      </Container>
    </main>
  );
}
