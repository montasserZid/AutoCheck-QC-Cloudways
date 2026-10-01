import { createContactPostHandler } from "@/server/contact/handler";
import { operationalRepository } from "@/server/data/operationalRepository";

export const dynamic = "force-dynamic";
export const POST = createContactPostHandler(operationalRepository);
