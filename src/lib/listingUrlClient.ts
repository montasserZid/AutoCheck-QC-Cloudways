import type { ListingUrlExtraction } from "./listingUrlExtraction";

export type ListingUrlClientResult =
  | {
      ok: true;
      status: "extracted" | "partial" | "empty";
      retrieval: { finalUrl: string; httpStatus: number };
      extraction: ListingUrlExtraction;
    }
  | {
      ok: false;
      status: "failed";
      code?: string;
      error: string;
    };

export async function extractListingUrl(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<ListingUrlClientResult> {
  let response: Response;
  try {
    response = await fetcher("/api/listing-extraction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    return {
      ok: false,
      status: "failed",
      error: "We couldn't automatically read this listing. Check your connection and try again.",
    };
  }

  try {
    return (await response.json()) as ListingUrlClientResult;
  } catch {
    return {
      ok: false,
      status: "failed",
      error: "We couldn't automatically read this listing.",
    };
  }
}
