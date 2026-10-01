import type {
  OperationalRepository,
  StoredOperationalRecord,
} from "./operationalRepository";

interface InsertedContactMessage {
  id: string;
  created_at: string;
}

export interface ContactMessageInsertRow {
  topic: string;
  customer_name: string;
  customer_email: string;
  message: string;
}

export type ContactMessageInserter = (
  row: ContactMessageInsertRow,
) => Promise<InsertedContactMessage>;

export class ContactMessagePersistenceError extends Error {
  constructor() {
    super("Contact message persistence failed.");
    this.name = "ContactMessagePersistenceError";
  }
}

export function createContactMessageRepository(
  insert: ContactMessageInserter,
): Pick<OperationalRepository, "createContactMessage"> {
  return {
    async createContactMessage(input): Promise<StoredOperationalRecord> {
      let record: InsertedContactMessage;
      try {
        record = await insert({
          topic: input.topic,
          customer_name: input.customerName,
          customer_email: input.customerEmail,
          message: input.message,
        });
      } catch {
        throw new ContactMessagePersistenceError();
      }

      if (
        !record ||
        typeof record.id !== "string" ||
        typeof record.created_at !== "string"
      ) {
        throw new ContactMessagePersistenceError();
      }

      return { id: record.id, createdAt: record.created_at };
    },
  };
}
