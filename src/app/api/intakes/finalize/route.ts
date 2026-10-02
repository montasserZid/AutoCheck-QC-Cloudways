import { createFinalizeIntakePostHandler } from "@/server/intakes/handler";
import { operationalRepository } from "@/server/data/operationalRepository";

export const dynamic = "force-dynamic";
export const POST = createFinalizeIntakePostHandler(operationalRepository);
