import type { ReportFinding, VehicleIntake } from "../types/domain";

interface VehicleKnowledge {
  make: string;
  model: string;
  area: string;
  rust: string;
  drivetrain: string;
  maintenance: string;
}
// Editorial inspection prompts, not defect frequency data. Equipment varies by year and trim.
export const vehicleKnowledge: VehicleKnowledge[] = [
  {
    make: "Honda",
    model: "Civic",
    area: "Check cooling and heating at idle and on the road; operate all windows and locks.",
    rust: "Check rocker panels, rear wheel arches and lifting points.",
    drivetrain:
      "Confirm the transmission type. Check for hesitation, clutch slip or unusual noise, as applicable.",
    maintenance:
      "Match service invoices to the exact engine and transmission; confirm fluid and spark-plug service against the owner's manual.",
  },
  {
    make: "Toyota",
    model: "Corolla",
    area: "Ask about oil top-ups between services and have leaks or unusual start-up noises assessed.",
    rust: "Check the floor, rocker seams, subframes and brake lines.",
    drivetrain:
      "Confirm whether this car has a manual, conventional automatic, CVT or hybrid drivetrain before selecting inspection checks.",
    maintenance:
      "Check oil, coolant and transmission-service records against the schedule for this year and engine.",
  },
  {
    make: "Mazda",
    model: "Mazda3",
    area: "Check lower door seams and hatch/trunk edges; test the display, controls and air conditioning.",
    rust: "Inspect wheel arches, rocker panels, floor seams and suspension mounting areas, including behind plastic covers where accessible.",
    drivetrain:
      "Check smooth shifting, clutch operation if fitted, and any drivetrain vibration during a road test.",
    maintenance:
      "Confirm the engine variant and compare oil, coolant, plugs and drive-belt records with its maintenance schedule.",
  },
  {
    make: "Honda",
    model: "CR-V",
    area: "Look for water traces in the cargo area. If AWD-equipped, ask an inspector to check tight-turn behaviour.",
    rust: "Check rear suspension mounting points, subframes, rocker panels and brake lines.",
    drivetrain:
      "Confirm AWD versus front-wheel drive; check transmission operation and rear-drive components if fitted.",
    maintenance:
      "Ask for transmission and, if applicable, rear-differential fluid records; verify the exact engine service schedule.",
  },
  {
    make: "Toyota",
    model: "RAV4",
    area: "Confirm gasoline, hybrid or plug-in hybrid and FWD/AWD. Electrified versions need an appropriately qualified inspection.",
    rust: "Check underbody seams, suspension mounts, rear subframe and brake lines.",
    drivetrain:
      "Check driveline noise and leaks; inspect AWD components only if fitted. Have hybrid systems assessed where applicable.",
    maintenance:
      "Compare coolant, oil and drivetrain service records with the schedule for the exact powertrain.",
  },
  {
    make: "Hyundai",
    model: "Elantra",
    area: "Ask about oil consumption and past engine work. Have unusual cold-start noise or warning lights assessed.",
    rust: "Inspect sill seams, rear wheel arches, floor and subframe areas.",
    drivetrain:
      "Identify the gearbox variant; check low-speed engagement, shift quality and any clutch judder where applicable.",
    maintenance:
      "Verify engine oil service intervals and repair documentation for this specific engine, rather than assuming all Elantras are alike.",
  },
  {
    make: "Honda",
    model: "Odyssey",
    area: "Operate both sliding doors repeatedly and test rear heating and cooling, seat movement and latches.",
    rust: "Inspect door tracks, rear wheel arches, rocker panels and underbody mounting areas.",
    drivetrain:
      "Check shift quality when cold and warm, engine mounts and vibrations under load.",
    maintenance:
      "Confirm the engine and whether it uses a timing belt; request dated belt-service invoices where applicable and transmission-fluid records.",
  },
  {
    make: "Toyota",
    model: "Sienna",
    area: "Test sliding doors, rear climate control, seat tracks and latches; check for water entry around door seals.",
    rust: "Check sliding-door sills, underbody seams and front and rear suspension mounting areas.",
    drivetrain:
      "Confirm the year and powertrain, including hybrid and AWD equipment where applicable; tailor the road test accordingly.",
    maintenance:
      "Check the exact engine's belt or chain requirements and coolant/drivetrain service schedule; do not assume the same schedule across generations.",
  },
  {
    make: "Nissan",
    model: "Rogue",
    area: "Confirm the transmission fitted. If CVT-equipped, ask an inspector to assess engagement, vibration and noise when cold and warm.",
    rust: "Check subframes, rocker seams, wheel arches and brake lines.",
    drivetrain:
      "Verify transmission-fluid history and, for AWD versions, check rear-drive components and matching tire sizes.",
    maintenance:
      "Compare invoices with the exact year's maintenance guide, including specified transmission fluid and applicable severe-use requirements.",
  },
];
export function getVehicleChecklist(intake: VehicleIntake): ReportFinding[] {
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const entry = vehicleKnowledge.find(
    (v) =>
      normalize(v.make) === normalize(intake.make) &&
      normalize(v.model) === normalize(intake.model),
  );
  return [
    {
      title: entry
        ? `${entry.make} ${entry.model}: areas to verify`
        : "General vehicle checklist",
      detail:
        entry?.area ??
        "Confirm the exact engine, transmission and equipment with the seller. This vehicle uses a general inspection checklist.",
    },
    {
      title: "Rust-sensitive areas to verify",
      detail:
        entry?.rust ??
        "Inspect rocker panels, wheel arches, brake lines, subframes and suspension mounting points.",
    },
    {
      title: "Drivetrain checks",
      detail:
        entry?.drivetrain ??
        "Check cold and warm operation, leaks, shifting, drivetrain noise and dashboard warnings.",
    },
    {
      title: "Maintenance items to confirm",
      detail:
        entry?.maintenance ??
        "Use the manufacturer's schedule for the exact year and engine; request dated service invoices.",
    },
    {
      title: "Suspension and brakes",
      detail:
        "Have an inspector check ball joints, bushings, shocks, wheel bearings, brake wear, hoses and tire wear. These are areas to verify, not confirmed faults.",
    },
    {
      title: "Age and mileage",
      detail:
        intake.mileageKm !== null && intake.mileageKm >= 150000
          ? `At ${intake.mileageKm.toLocaleString("en-CA")} km, documented maintenance and the condition of wear items deserve particular attention. Ask for estimates only after inspection.`
          : "Compare age and mileage with dated invoices. Check tires, rubber hoses, seals and battery condition even when mileage is low or unstated.",
    },
  ];
}
