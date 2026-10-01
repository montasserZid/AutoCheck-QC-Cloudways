import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { VehicleIntakeFlow } from "@/components/VehicleIntakeFlow";

export const metadata: Metadata = {
  title: "Check a Car",
  description:
    "Paste a used-car ad, review the extracted details and get a clear buyer checklist.",
};

export default function CheckPage() {
  return (
    <main className="page-shell">
      <Container>
        <VehicleIntakeFlow />
      </Container>
    </main>
  );
}
