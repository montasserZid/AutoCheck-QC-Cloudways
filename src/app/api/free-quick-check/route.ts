import { createFreeQuickCheckPostHandler } from "@/server/freeQuickCheck/handler";
import { freeQuickCheckRepository } from "@/server/knowledge/freeQuickCheckRepository";

export const dynamic = "force-dynamic";
export const POST = createFreeQuickCheckPostHandler(freeQuickCheckRepository);
