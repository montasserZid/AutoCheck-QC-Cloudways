import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/Container";
import { ReportExperience } from "@/components/ReportExperience";

export const metadata: Metadata = {
  title: "Buyer Report",
  description:
    "Review listing risks, seller questions and your next step before buying.",
};

export default function ReportPage() {
  return (
    <main className="page-shell">
      <Container>
        <Suspense
          fallback={
            <div className="loading-panel">
              <p className="eyebrow">Loading</p>
              <h1>Preparing report...</h1>
            </div>
          }
        >
          <ReportExperience />
        </Suspense>
      </Container>
    </main>
  );
}
