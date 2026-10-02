import type { FinalizedIntakeValue } from "../finalizedIntake";

export interface FinalizedIntakeRecord {
  vehicleId: string;
  listingId: string;
  replayed: boolean;
}

export type FinalizedIntakeRpc = (input: FinalizedIntakeValue) => Promise<FinalizedIntakeRecord>;

export class FinalizedIntakePersistenceError extends Error {
  constructor() {
    super("Finalized intake persistence failed.");
    this.name = "FinalizedIntakePersistenceError";
  }
}

export function createFinalizedIntakeRepository(
  persist: FinalizedIntakeRpc,
): { finalizeIntake(input: FinalizedIntakeValue): Promise<FinalizedIntakeRecord> } {
  return {
    async finalizeIntake(input) {
      try {
        const result = await persist(input);
        if (!result || typeof result.vehicleId !== "string" || typeof result.listingId !== "string" || typeof result.replayed !== "boolean")
          throw new Error("Invalid persistence response.");
        return result;
      } catch {
        throw new FinalizedIntakePersistenceError();
      }
    },
  };
}
