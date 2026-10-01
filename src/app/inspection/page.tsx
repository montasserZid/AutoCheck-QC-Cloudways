import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { InspectionBookingForm } from "@/components/InspectionBookingForm";

export const metadata: Metadata = {
  title: "Book a Mobile Inspection",
  description:
    "Prepare a mobile inspection request for a used car in Montreal and surrounding areas.",
};

export default function InspectionPage() {
  return (
    <main className="page-shell">
      <Container>
        <InspectionBookingForm />
      </Container>
    </main>
  );
}
