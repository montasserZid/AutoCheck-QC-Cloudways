import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { ReportView } from "@/components/ReportView";
import { demoVehicleIntake, exampleListingText } from "@/lib/mockData";
import { generateDemoReport } from "@/lib/reportEngine";

export const metadata: Metadata = {
  title: "Example Report",
  description:
    "See a complete example buyer report for a 2017 Mazda3, with seller questions and an inspection checklist.",
};

export default function ExampleReportPage() {
  const report = generateDemoReport(demoVehicleIntake, "full");

  return (
    <main className="page-shell">
      <Container>
        <div className="example-intro">
          <p className="eyebrow">An example, from ad to decision</p>
          <p>
            An illustrative 2017 Mazda3 listing. The report below uses details
            extracted from this text, with missing VIN and history left unknown.
          </p>
          <details>
            <summary>See the original listing and extracted details</summary>
            <blockquote>{exampleListingText}</blockquote>
            <p>
              Found: 2017 / Mazda / Mazda3 / GS / 168,000 km / $8,900 CAD /
              Laval / private seller / inspection allowed.
            </p>
            <p>
              Missing: VIN, Carfax, accident and rebuilt status, maintenance
              records.
            </p>
          </details>
        </div>
        <ReportView report={report} example />
      </Container>
    </main>
  );
}
