import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildFacebookDetailVariables,
  countFacebookStructuredFields,
  decodeFacebookGraphqlBody,
  discoverFacebookDocIds,
  extractFacebookStructuredOgMeta,
  facebookStructuredSafeUrl,
  parseFacebookListingPhotosResponse,
  parseFacebookMarketplaceDetailResponse,
  selectFacebookDetailDocId,
  selectFacebookImagesDocId,
  surveyFacebookStructuredDocument,
} from "../deploy/cloudways-worker/scripts/facebookStructured";

const REQUESTED_ID = "4948179818741919";
const OTHER_ID = "3333333333333333";
const REQUESTED_URL = `https://www.facebook.com/marketplace/item/${REQUESTED_ID}/`;

function detailTarget(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: REQUESTED_ID,
    marketplace_listing_title: "1987 944S Porsche parts car",
    base_marketplace_listing_title: "1987 944S Porsche parts car",
    redacted_description: { text: "Rebuilt engine with crank scraper." },
    listing_price: {
      formatted_amount_zeros_stripped: "$5,000",
      amount: "5000.00",
      currency: "USD",
    },
    location_text: { text: "Santa Cruz, CA" },
    attribute_data: [{ attribute_name: "Condition", label: "Used - Fair" }],
    marketplaceListingRenderableIfLoggedOut: {
      marketplace_listing_category_name: "Auto parts",
    },
    delivery_types: ["IN_PERSON"],
    creation_time: 1783098746,
    is_pending: false,
    is_sold: false,
    is_live: true,
    ...overrides,
  };
}

function detailResponse(
  target: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    data: {
      viewer: {
        marketplace_product_details_page: { target },
      },
    },
    extensions: { is_final: true },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. Valid structured listing with matching requested id -> accepted
// ---------------------------------------------------------------------------

test("valid structured listing with matching requested id is accepted", () => {
  const result = parseFacebookMarketplaceDetailResponse(
    detailResponse(detailTarget()),
    REQUESTED_ID,
  );
  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.equal(result.listing.id, REQUESTED_ID);
  assert.equal(result.listing.tiedToRequestedId, true);
  assert.equal(result.listing.title, "1987 944S Porsche parts car");
  assert.equal(result.listing.priceFormatted, "$5,000");
  assert.equal(result.listing.priceAmount, "5000.00");
  assert.equal(result.listing.currency, "USD");
  assert.equal(result.listing.location, "Santa Cruz, CA");
  assert.equal(result.listing.condition, "Used - Fair");
  assert.equal(result.listing.category, "Auto parts");
  assert.equal(result.listing.status, "available");
  assert.equal(
    result.listing.url,
    `https://www.facebook.com/marketplace/item/${REQUESTED_ID}/`,
  );
  assert.equal(result.listing.creationTimeUnix, 1783098746);
  assert.equal(typeof countFacebookStructuredFields(result.listing), "number");
  assert.ok(countFacebookStructuredFields(result.listing) >= 12);
});

// ---------------------------------------------------------------------------
// 2. Structured listing with a different id -> rejected
// ---------------------------------------------------------------------------

test("structured listing carrying a different id is rejected as id-mismatch", () => {
  const result = parseFacebookMarketplaceDetailResponse(
    detailResponse(detailTarget({ id: OTHER_ID })),
    REQUESTED_ID,
  );
  assert.equal(result.status, "rejected");
  if (result.status !== "rejected") return;
  assert.equal(result.reason, "id-mismatch");
});

// ---------------------------------------------------------------------------
// 3. Login next= URL containing the requested id is NOT identity evidence
// ---------------------------------------------------------------------------

test("a login next= URL containing the requested id is never identity evidence", () => {
  const loginHtml = [
    "<!DOCTYPE html><html><head><title>Log in to Facebook</title></head><body>",
    `<form action="/login/?next=https%3A%2F%2Fwww.facebook.com%2Fmarketplace%2Fitem%2F${REQUESTED_ID}%2F" method="post">`,
    `<a href="https://www.facebook.com/login/?next=https://www.facebook.com/marketplace/item/${REQUESTED_ID}/">Continue</a>`,
    "</form></body></html>",
  ].join("");

  const survey = surveyFacebookStructuredDocument({
    requestedItemId: REQUESTED_ID,
    finalUrl: "https://www.facebook.com/login/",
    status: 200,
    html: loginHtml,
  });
  assert.equal(survey.requestedIdTied, false);
  assert.equal(survey.requestedIdTiedVia.canonical, false);
  assert.equal(survey.requestedIdTiedVia.ogUrl, false);
  assert.equal(survey.requestedIdTiedVia.finalPath, false);
  assert.equal(survey.idOnlyInLoginParams, true);
  assert.equal(survey.finalPathCategory, "login");
  assert.ok(survey.requestedIdOccurrences > 0);

  // The structured parser is equally immune: a payload whose only id
  // appearance is inside a login redirect URL has no detail target.
  const redirected = decodeFacebookGraphqlBody(
    JSON.stringify({
      data: { viewer: {} },
      redirect: `https://www.facebook.com/login/?next=${REQUESTED_URL}`,
    }),
  );
  const parsed = parseFacebookMarketplaceDetailResponse(redirected.json, REQUESTED_ID);
  assert.equal(parsed.status, "rejected");
  if (parsed.status === "rejected") assert.equal(parsed.reason, "no-target");
});

// ---------------------------------------------------------------------------
// 4. Malformed JSON -> safe failure
// ---------------------------------------------------------------------------

test("malformed JSON fails safely without throwing", () => {
  for (const body of ["{ nope", "", "<!DOCTYPE html><html>login</html>", "for (;;);{broken"]) {
    const decoded = decodeFacebookGraphqlBody(body);
    assert.equal(decoded.json, null);
    const parsed = parseFacebookMarketplaceDetailResponse(decoded.json, REQUESTED_ID);
    assert.equal(parsed.status, "rejected");
    if (parsed.status === "rejected") {
      assert.equal(parsed.reason, "malformed");
    }
  }

  // XSSI prefix on a healthy answer still decodes and accepts.
  const xssi = decodeFacebookGraphqlBody(`for (;;);${JSON.stringify(detailResponse(detailTarget()))}`);
  assert.equal(xssi.kind, "xssi-json");
  const parsed = parseFacebookMarketplaceDetailResponse(xssi.json, REQUESTED_ID);
  assert.equal(parsed.status, "accepted");
});

// ---------------------------------------------------------------------------
// 5. Multiple candidate objects -> the correct matching object is selected
// ---------------------------------------------------------------------------

test("multiple candidate objects select the matching detail target", () => {
  const response = {
    data: {
      viewer: {
        marketplace_product_details_page: { target: detailTarget() },
      },
      marketplace_search: {
        feed_units: {
          edges: [
            {
              node: {
                listing: {
                  id: OTHER_ID,
                  marketplace_listing_title: "Another listing",
                  listing_price: { formatted_amount: "$42" },
                },
              },
            },
          ],
        },
      },
    },
  };
  const result = parseFacebookMarketplaceDetailResponse(response, REQUESTED_ID);
  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.equal(result.listing.id, REQUESTED_ID);
  assert.equal(result.listing.title, "1987 944S Porsche parts car");
  assert.equal(result.otherListingObjectCount, 1);
  assert.equal(result.detailTargetCount, 1);
});

// ---------------------------------------------------------------------------
// 6. Conflicting ids -> rejected
// ---------------------------------------------------------------------------

test("conflicting ids across detail targets reject the result", () => {
  const response = {
    data: {
      viewer: {
        marketplace_product_details_page: { target: detailTarget() },
        marketplace_product_details_page_related: {
          target: detailTarget({ id: OTHER_ID, marketplace_listing_title: "Other" }),
        },
      },
    },
  };
  const result = parseFacebookMarketplaceDetailResponse(response, REQUESTED_ID);
  assert.equal(result.status, "rejected");
  if (result.status !== "rejected") return;
  assert.equal(result.reason, "conflicting-ids");
});

// ---------------------------------------------------------------------------
// 7. Missing listing id -> rejected
// ---------------------------------------------------------------------------

test("a detail target without a usable listing id is rejected", () => {
  for (const idValue of [undefined, "", "not-a-number"]) {
    const target = detailTarget({ marketplace_listing_title: "No id" });
    if (idValue === undefined) delete target.id;
    else target.id = idValue;
    const result = parseFacebookMarketplaceDetailResponse(
      detailResponse(target),
      REQUESTED_ID,
    );
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.equal(result.reason, "missing-listing-id");
    }
  }
});

// ---------------------------------------------------------------------------
// 8. Vehicle fields normalize correctly
// ---------------------------------------------------------------------------

test("vehicle attribute pairs normalize into structured vehicle fields", () => {
  const target = detailTarget({
    marketplace_listing_title: "1987 Porsche 944 S",
    attribute_data: [
      { attribute_name: "Year", label: "1987" },
      { attribute_name: "Make", label: "Porsche" },
      { attribute_name: "Model", label: "944" },
      { attribute_name: "Trim", label: "S" },
      { attribute_name: "Mileage", label: "140,000 mi" },
      { attribute_name: "Transmission", label: "Manual" },
      { attribute_name: "Fuel", label: "Gasoline" },
      { attribute_name: "Condition", label: "Used - Fair" },
    ],
  });
  const result = parseFacebookMarketplaceDetailResponse(
    detailResponse(target),
    REQUESTED_ID,
  );
  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.deepEqual(result.listing.vehicle, {
    year: "1987",
    make: "Porsche",
    model: "944",
    trim: "S",
    mileage: "140,000 mi",
    transmission: "Manual",
    fuel: "Gasoline",
  });
  assert.equal(result.listing.condition, "Used - Fair");
  assert.equal(result.listing.attributes.length, 8);
});

// ---------------------------------------------------------------------------
// 9. No raw secrets/HTML leak through diagnostics
// ---------------------------------------------------------------------------

test("diagnostic outputs never leak raw HTML, tokens, cookies or query strings", () => {
  const hostileHtml = [
    "<!DOCTYPE html><html><head>",
    `<meta property="og:title" content="1987 944S Porsche parts car">`,
    `<meta property="og:description" content="Parts car for sale.">`,
    `<meta property="og:url" content="${REQUESTED_URL}?__cft__=deadbeef&__tn__=xx">`,
    `<link rel="canonical" href="${REQUESTED_URL}?__cft__=deadbeef">`,
    "</head><body>",
    `<script>document.cookie="xs=secret-token; c_user=123";</script>`,
    `<script>{"__cft__":"deadbeef","csrf":"secretvalue"}</script>`,
    `<input name="pass" type="password">`,
    `<a href="https://www.facebook.com/login/?next=${REQUESTED_URL}">log in</a>`,
    "</body></html>",
  ].join("");

  const survey = surveyFacebookStructuredDocument({
    requestedItemId: REQUESTED_ID,
    finalUrl: `${REQUESTED_URL}?__cft__=deadbeef`,
    status: 200,
    html: hostileHtml,
  });
  const og = extractFacebookStructuredOgMeta(hostileHtml);
  const parsed = parseFacebookMarketplaceDetailResponse(
    detailResponse(
      detailTarget({
        listing_photos: [
          {
            image: {
              uri: "https://scontent.example.fbcdn.net/v/photo.jpg?_nc_cat=1&oh=token",
              width: 540,
              height: 960,
            },
          },
        ],
      }),
    ),
    REQUESTED_ID,
  );
  assert.equal(parsed.status, "accepted");

  const surveyText = JSON.stringify(survey);
  const ogText = JSON.stringify(og);
  const parsedText = JSON.stringify(parsed);
  const combined = `${surveyText}\n${ogText}\n${parsedText}`;

  for (const forbidden of [
    "__cft__",
    "deadbeef",
    "secretvalue",
    "secret-token",
    "document.cookie",
    'name="pass"',
    "<meta",
    "<script",
    "</html>",
    "password",
  ]) {
    assert.equal(combined.includes(forbidden), false, `output leaked ${forbidden}`);
  }
  // No surfaced URL may carry a query string.
  const queryUrl = /https?:\/\/[^\s"\\]+\?/;
  assert.equal(queryUrl.test(parsedText), false, "structured output leaked a query string");
  assert.equal(
    JSON.stringify(facebookStructuredSafeUrl(`${REQUESTED_URL}?__cft__=x`)),
    JSON.stringify(REQUESTED_URL),
  );
  assert.ok(combined.length < 30_000, "diagnostic output must stay bounded");
});

// ---------------------------------------------------------------------------
// 10. Production extraction behaviour remains unchanged / not integrated
// ---------------------------------------------------------------------------

function findRepoRoot(): string {
  let current = __dirname;
  for (let depth = 0; depth < 10; depth += 1) {
    const manifest = path.join(current, "package.json");
    if (fs.existsSync(manifest)) {
      const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: string };
      if (parsed.name === "autocheck-qc") return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not locate the AutoCheck repository root from ${__dirname}`);
}

test("production extraction never imports the experimental structured modules", () => {
  const root = findRepoRoot();
  const productionFiles = [
    "src/server/listing/handler.ts",
    "src/server/listing/facebook.ts",
    "src/server/listing/browserWorker.ts",
    "src/server/listing/secureFetch.ts",
    "deploy/cloudways-worker/src/render.ts",
    "deploy/cloudways-worker/src/server.ts",
    "deploy/cloudways-worker/src/main.ts",
    "deploy/cloudways-worker/src/logging.ts",
  ];
  for (const relative of productionFiles) {
    const absolute = path.join(root, relative);
    assert.equal(fs.existsSync(absolute), true, `${relative} is missing`);
    const source = fs.readFileSync(absolute, "utf8");
    assert.equal(
      source.includes("facebookStructured"),
      false,
      `${relative} references the experimental structured module`,
    );
    assert.equal(
      source.includes("facebook-structured-diagnostic"),
      false,
      `${relative} references the experimental diagnostic CLI`,
    );
  }
});

// ---------------------------------------------------------------------------
// Doc-id discovery from the page's own public preloader metadata
// ---------------------------------------------------------------------------

test("doc ids are discovered from expectedPreloaders and the PDP pair is selected", () => {
  const html = [
    '<html><head></head><body><script>if (window.initialData) {',
    '"expectedPreloaders":[',
    '{"actorID":"0","queryID":"9703687583048540","queryName":"useCometLogInFormQuery","variables":{}}',
    ',{"actorID":"0","queryID":"10059604367394414","queryName":"MarketplacePDPC2CMediaViewerWithImagesQuery","variables":{"targetId":"x"}}',
    ',{"actorID":"0","queryID":"38856723643971385","queryName":"MarketplacePDPContainerQuery","variables":{"targetId":"123","scale":2}}',
    "]}</script></body></html>",
  ].join("");

  const candidates = discoverFacebookDocIds(html);
  assert.equal(candidates.length, 3);
  const detail = selectFacebookDetailDocId(candidates);
  assert.equal(detail?.queryID, "38856723643971385");
  assert.equal(detail?.variables?.targetId, "123");
  const images = selectFacebookImagesDocId(candidates);
  assert.equal(images?.queryID, "10059604367394414");

  // A login wall or an unparsable block yields no candidates, never a throw.
  assert.deepEqual(discoverFacebookDocIds("<html>login wall</html>"), []);
  assert.deepEqual(discoverFacebookDocIds('"expectedPreloaders":[broken'), []);
});

// ---------------------------------------------------------------------------
// Positive survey expectations (item page with genuine metadata)
// ---------------------------------------------------------------------------

test("a genuine item document ties the requested id through every evidence channel", () => {
  const html = [
    "<!DOCTYPE html><html><head>",
    `<meta property="og:title" content="1987 944S Porsche parts car">`,
    `<meta property="og:description" content="Parts car for sale in Santa Cruz.">`,
    `<meta property="og:url" content="${REQUESTED_URL}">`,
    `<link rel="canonical" href="${REQUESTED_URL}">`,
    "</head><body>",
    '"expectedPreloaders":[{"queryID":"38856723643971385","queryName":"MarketplacePDPContainerQuery"}]',
    "RelayPrefetchedStreamCache marker",
    "</body></html>",
  ].join("");

  const survey = surveyFacebookStructuredDocument({
    requestedItemId: REQUESTED_ID,
    finalUrl: REQUESTED_URL,
    status: 200,
    html,
  });
  assert.equal(survey.requestedIdTied, true);
  assert.deepEqual(survey.requestedIdTiedVia, { canonical: true, ogUrl: true, finalPath: true });
  assert.equal(survey.idOnlyInLoginParams, false);
  assert.equal(survey.conflictingIdInEvidence, false);
  assert.equal(survey.finalPathCategory, "marketplace-item");
  assert.equal(survey.canonicalCategory, "marketplace-item");
  assert.equal(survey.hasOgTitle, true);
  assert.equal(survey.hasOgDescription, true);
  assert.equal(survey.ogTitle, "1987 944S Porsche parts car");
  assert.equal(survey.expectedPreloadersCount, 1);
  assert.equal(survey.relayCandidateCount, 1);

  // A foreign item id in the evidence URLs is a conflict, never a tie.
  const foreign = surveyFacebookStructuredDocument({
    requestedItemId: REQUESTED_ID,
    finalUrl: `https://www.facebook.com/marketplace/item/${OTHER_ID}/`,
    status: 200,
    html: `<link rel="canonical" href="https://www.facebook.com/marketplace/item/${OTHER_ID}/">`,
  });
  assert.equal(foreign.requestedIdTied, false);
  assert.equal(foreign.conflictingIdInEvidence, true);
});

// ---------------------------------------------------------------------------
// Photos answer obeys the same identity rule
// ---------------------------------------------------------------------------

test("photos are surfaced only for a target whose id matches the request", () => {
  const good = parseFacebookListingPhotosResponse(
    detailResponse(
      detailTarget({
        listing_photos: [
          { image: { uri: "https://scontent.example.fbcdn.net/v/a.jpg?oh=token", width: 1, height: 2 } },
          { image: { uri: "https://scontent.example.fbcdn.net/v/b.jpg?oh=token", width: 3, height: 4 } },
        ],
      }),
    ),
    REQUESTED_ID,
  );
  assert.equal(good.status, "accepted");
  if (good.status === "accepted") {
    assert.equal(good.photoCount, 2);
    assert.deepEqual(good.photos, [
      "https://scontent.example.fbcdn.net/v/a.jpg",
      "https://scontent.example.fbcdn.net/v/b.jpg",
    ]);
  }

  const bad = parseFacebookListingPhotosResponse(
    detailResponse(detailTarget({ id: OTHER_ID, listing_photos: [] })),
    REQUESTED_ID,
  );
  assert.equal(bad.status, "rejected");
  if (bad.status === "rejected") assert.equal(bad.reason, "id-mismatch");
});

// ---------------------------------------------------------------------------
// Detail variables Facebook's logged-out PDP requires
// ---------------------------------------------------------------------------

test("detail variables carry the relay provider flags Facebook requires", () => {
  const variables = buildFacebookDetailVariables(REQUESTED_ID);
  assert.equal(variables.targetId, REQUESTED_ID);
  assert.equal(variables.feedbackSource, 56);
  assert.equal(variables.useDefaultActor, false);
  const providerFlags = Object.keys(variables).filter((key) =>
    key.startsWith("__relay_internal__pv__"),
  );
  assert.equal(providerFlags.length >= 10, true);
});
