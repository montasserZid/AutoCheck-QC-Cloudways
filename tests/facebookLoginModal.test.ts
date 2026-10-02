import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FacebookExtractionError,
  facebookLoginWallDismissInPage,
  facebookLoginWallSurveyInPage,
  facebookRenderProbeInPage,
  settle,
  type FacebookLoginWallSurvey,
  type FacebookRenderProbe,
} from "../src/server/listing/facebook";
import { sanitizeRenderDiagnostics } from "../deploy/cloudways-worker/src/logging";

/**
 * Regression suite for the bounded login-modal diagnostics and dismissal.
 *
 * `settle()` is exercised end to end through a fake PageLike whose
 * `evaluate` dispatches on the identity of the exported in-page functions —
 * the same seam Puppeteer uses when it serialises a function into the page.
 * No test launches a browser, and every scenario asserts both the visible
 * outcome (ready / FACEBOOK_LOGIN_REQUIRED) and the click budget (0 or 1).
 */

const ITEM_ID = "4948179818741919";

// --- Fixtures: page probes (raw signals, as reported by the in-page probe) --

/** Case B candidate: still on the item path, but the title says login. */
const LOGIN_MODAL_ITEM_PROBE: FacebookRenderProbe = {
  host: "www.facebook.com",
  path: `/marketplace/item/${ITEM_ID}/`,
  title: "Log in to Facebook",
  readyState: "complete",
  bodyTextLength: 5200,
  hasOgUrl: true,
  hasMarketplaceMarker: true,
  hasListingDetailMarkers: true,
};

/** The same page after the modal closed: a normal, readable listing. */
const READY_ITEM_PROBE: FacebookRenderProbe = {
  host: "www.facebook.com",
  path: `/marketplace/item/${ITEM_ID}/`,
  title: "2018 Toyota Corolla LE | Facebook",
  readyState: "complete",
  bodyTextLength: 6100,
  hasOgUrl: true,
  hasMarketplaceMarker: true,
  hasListingDetailMarkers: true,
};

/** Case A: Facebook redirected the anonymous request to a real /login page. */
const LOGIN_PAGE_PROBE: FacebookRenderProbe = {
  host: "www.facebook.com",
  path: "/login/device-based/regular/login/",
  title: "Log in to Facebook",
  readyState: "complete",
  bodyTextLength: 412,
  hasOgUrl: false,
  hasMarketplaceMarker: false,
  hasListingDetailMarkers: false,
};

// --- Fixtures: login-wall surveys (log-safe signals only) -------------------

const SURVEY_MODAL_OVER_LISTING: FacebookLoginWallSurvey = {
  bodyTextLength: 5200,
  visibleDialogCount: 1,
  authDialogCount: 1,
  safeDismissControl: {
    controlType: "role-button",
    labelSource: "aria-label",
    labelKind: "close",
  },
  listingMarkersOutsideDialog: true,
  marketplaceItemLinksOutsideDialog: 3,
};

const SURVEY_MODAL_CLOSED: FacebookLoginWallSurvey = {
  bodyTextLength: 6100,
  visibleDialogCount: 0,
  authDialogCount: 0,
  safeDismissControl: null,
  listingMarkersOutsideDialog: true,
  marketplaceItemLinksOutsideDialog: 5,
};

/** The modal exists but offers no semantically labelled close control. */
const SURVEY_MODAL_WITHOUT_CLOSE: FacebookLoginWallSurvey = {
  ...SURVEY_MODAL_OVER_LISTING,
  safeDismissControl: null,
};

const SURVEY_LOGIN_PAGE: FacebookLoginWallSurvey = {
  bodyTextLength: 412,
  visibleDialogCount: 0,
  authDialogCount: 0,
  safeDismissControl: null,
  listingMarkersOutsideDialog: false,
  marketplaceItemLinksOutsideDialog: 0,
};

// --- Fake page ---------------------------------------------------------------

interface FakePageState {
  probe: () => FacebookRenderProbe;
  survey: () => FacebookLoginWallSurvey;
  onDismiss?: () => { clicked: boolean; outcome: string };
}

function createFakePage(state: FakePageState) {
  const counts = { probe: 0, survey: 0, dismiss: 0 };
  const page = {
    close: async (): Promise<void> => undefined,
    goto: async (): Promise<unknown> => null,
    evaluate: async <T>(fn: () => T): Promise<T> => {
      const identity = fn as unknown;
      if (identity === (facebookRenderProbeInPage as unknown)) {
        counts.probe += 1;
        return state.probe() as unknown as T;
      }
      if (identity === (facebookLoginWallSurveyInPage as unknown)) {
        counts.survey += 1;
        return state.survey() as unknown as T;
      }
      if (identity === (facebookLoginWallDismissInPage as unknown)) {
        counts.dismiss += 1;
        const result = state.onDismiss
          ? state.onDismiss()
          : { clicked: false, outcome: "no-safe-control" };
        return result as unknown as T;
      }
      throw new Error("unexpected page.evaluate function in fake page");
    },
  };
  return { page, counts };
}

function renderDiagnosticsOf(error: FacebookExtractionError): Record<string, unknown> {
  const render = error.diagnostics?.render;
  assert.ok(render && typeof render === "object", "the failure must carry render diagnostics");
  return render as Record<string, unknown>;
}

// --- Tests -------------------------------------------------------------------

test("dismissible login modal over a listing: close clicked, readiness recovered", async () => {
  const state = { dismissed: false };
  const { page, counts } = createFakePage({
    probe: () => (state.dismissed ? READY_ITEM_PROBE : LOGIN_MODAL_ITEM_PROBE),
    survey: () => (state.dismissed ? SURVEY_MODAL_CLOSED : SURVEY_MODAL_OVER_LISTING),
    onDismiss: () => {
      state.dismissed = true;
      return { clicked: true, outcome: "clicked" };
    },
  });

  const result = await settle(page, Date.now() + 10_000, "share");

  assert.equal(result.summary?.pathCategory, "marketplace-item");
  assert.equal(result.summary?.titleCategory, "facebook-page");
  assert.equal(result.dismissal?.action, "attempt");
  assert.equal(result.dismissal?.reason, "dismissible-login-modal-over-listing");
  assert.equal(result.dismissal?.clickResult, "clicked");
  assert.equal(result.dismissal?.dialogClosedAfterClick, true);
  assert.equal(result.dismissal?.recovered, true);
  assert.equal(result.wall?.pathCategory, "marketplace-item");
  assert.equal(result.wall?.authDialogCount, 1);
  assert.equal(result.wall?.hasSafeControl, true);
  assert.equal(result.wall?.listingMarkersOutsideDialog, true);
  assert.equal(counts.dismiss, 1, "exactly one dismissal click per wall");
  assert.ok(counts.survey >= 2, "the survey runs before the click and again for stabilisation");
});

test("true /login redirect: no dismissal attempt, FACEBOOK_LOGIN_REQUIRED preserved", async () => {
  const { page, counts } = createFakePage({
    probe: () => LOGIN_PAGE_PROBE,
    survey: () => SURVEY_LOGIN_PAGE,
  });

  await assert.rejects(
    () => settle(page, Date.now() + 10_000, "share"),
    (error: unknown) => {
      assert.ok(error instanceof FacebookExtractionError);
      assert.equal(error.code, "FACEBOOK_LOGIN_REQUIRED");
      const render = renderDiagnosticsOf(error);
      assert.equal(render.reason, "login-wall");
      const wall = render.wall as Record<string, unknown>;
      assert.equal(wall.pathCategory, "login");
      const dismissal = render.dismissal as Record<string, unknown>;
      assert.equal(dismissal.action, "not-applicable");
      assert.equal(dismissal.reason, "redirected-to-login");
      assert.equal(dismissal.clickResult, "not-attempted");
      assert.equal(dismissal.recovered, false);
      return true;
    },
  );
  assert.equal(counts.dismiss, 0, "a real /login page must never be clicked");
});

test("modal without a safe semantic close control: no arbitrary click", async () => {
  const { page, counts } = createFakePage({
    probe: () => LOGIN_MODAL_ITEM_PROBE,
    survey: () => SURVEY_MODAL_WITHOUT_CLOSE,
  });

  await assert.rejects(
    () => settle(page, Date.now() + 10_000, "share"),
    (error: unknown) => {
      assert.ok(error instanceof FacebookExtractionError);
      assert.equal(error.code, "FACEBOOK_LOGIN_REQUIRED");
      const render = renderDiagnosticsOf(error);
      const wall = render.wall as Record<string, unknown>;
      assert.equal(wall.authDialogCount, 1);
      assert.equal(wall.hasSafeControl, false);
      assert.equal(wall.listingMarkersOutsideDialog, true);
      const dismissal = render.dismissal as Record<string, unknown>;
      assert.equal(dismissal.action, "no-safe-control");
      assert.equal(dismissal.reason, "no-labeled-close-control");
      assert.equal(dismissal.clickResult, "not-attempted");
      return true;
    },
  );
  assert.equal(counts.dismiss, 0, "no button may be clicked without a labelled close control");
});

test("close clicked but the listing still unavailable: FACEBOOK_LOGIN_REQUIRED preserved", async () => {
  const { page, counts } = createFakePage({
    probe: () => LOGIN_MODAL_ITEM_PROBE,
    survey: () => SURVEY_MODAL_OVER_LISTING,
    onDismiss: () => ({ clicked: true, outcome: "clicked" }),
  });

  await assert.rejects(
    () =>
      settle(page, Date.now() + 10_000, "share", {
        stabilizationPollIntervalMs: 5,
        stabilizationTimeoutMs: 50,
      }),
    (error: unknown) => {
      assert.ok(error instanceof FacebookExtractionError);
      assert.equal(error.code, "FACEBOOK_LOGIN_REQUIRED");
      const render = renderDiagnosticsOf(error);
      assert.equal(render.reason, "login-wall");
      const dismissal = render.dismissal as Record<string, unknown>;
      assert.equal(dismissal.clickResult, "clicked");
      assert.equal(dismissal.dialogClosedAfterClick, false);
      assert.equal(dismissal.recovered, false);
      assert.ok((dismissal.stabilizationPolls as number) > 0);
      return true;
    },
  );
  assert.equal(counts.dismiss, 1);
});

test("ordinary listing without a modal: settle behaves exactly as before", async () => {
  const { page, counts } = createFakePage({
    probe: () => READY_ITEM_PROBE,
    survey: () => SURVEY_MODAL_OVER_LISTING,
  });

  const result = await settle(page, Date.now() + 10_000, "share");

  assert.equal(result.summary?.pathCategory, "marketplace-item");
  assert.equal(result.summary?.titleCategory, "facebook-page");
  assert.equal(result.dismissal, null);
  assert.equal(result.wall, null);
  assert.equal(counts.survey, 0, "no survey runs unless a login wall appears");
  assert.equal(counts.dismiss, 0, "no dismissal runs unless a login wall appears");
});

test("bounded: at most one click per wall, even when readiness never recovers", async () => {
  const state = { dismissed: false };
  const { page, counts } = createFakePage({
    probe: () => LOGIN_MODAL_ITEM_PROBE,
    survey: () => (state.dismissed ? SURVEY_MODAL_CLOSED : SURVEY_MODAL_OVER_LISTING),
    onDismiss: () => {
      state.dismissed = true;
      return { clicked: true, outcome: "clicked" };
    },
  });

  await assert.rejects(
    () =>
      settle(page, Date.now() + 10_000, "share", {
        stabilizationPollIntervalMs: 5,
        stabilizationTimeoutMs: 60,
      }),
    (error: unknown) => {
      assert.ok(error instanceof FacebookExtractionError);
      assert.equal(error.code, "FACEBOOK_LOGIN_REQUIRED");
      const dismissal = renderDiagnosticsOf(error).dismissal as Record<string, unknown>;
      assert.equal(dismissal.clickResult, "clicked");
      assert.equal(dismissal.dialogClosedAfterClick, true);
      assert.equal(dismissal.recovered, false, "the retry readiness check failed");
      return true;
    },
  );
  assert.equal(counts.dismiss, 1, "repeated clicking is forbidden");
  assert.ok(counts.survey >= 2, "the survey and stabilisation polls still ran");
});

test("login-wall diagnostics never expose raw HTML, cookies, secrets or the raw URL", async () => {
  const rawTitle =
    '<html lang="en">Log in to Facebook c_user=SECRET_COOKIE sessionid=SECRET_SESSION</html>';
  const hostileProbe: FacebookRenderProbe = {
    host: "www.facebook.com",
    path: "/login/device-based/regular/login/",
    title: rawTitle,
    readyState: "complete",
    bodyTextLength: 412,
    hasOgUrl: false,
    hasMarketplaceMarker: false,
    hasListingDetailMarkers: false,
  };
  const { page } = createFakePage({
    probe: () => hostileProbe,
    survey: () => SURVEY_LOGIN_PAGE,
  });

  let captured: Record<string, unknown> | undefined;
  await assert.rejects(
    () => settle(page, Date.now() + 10_000, "share"),
    (error: unknown) => {
      assert.ok(error instanceof FacebookExtractionError);
      assert.equal(error.code, "FACEBOOK_LOGIN_REQUIRED");
      captured = error.diagnostics;
      return true;
    },
  );
  assert.ok(captured);

  const serialized = JSON.stringify(captured);
  for (const forbidden of [
    "SECRET_COOKIE",
    "SECRET_SESSION",
    "c_user",
    "sessionid",
    "<html",
    "Log in to Facebook",
    "/login/device-based",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
  }

  // The worker trust boundary keeps the safe sections and drops everything else.
  const render = (captured as { render?: Record<string, unknown> }).render;
  assert.ok(render);
  const safe = sanitizeRenderDiagnostics(render);
  assert.ok(safe);
  const safeSerialized = JSON.stringify(safe);
  assert.equal(safeSerialized.includes("SECRET_COOKIE"), false);
  assert.equal(safeSerialized.includes("Log in to Facebook"), false);
  assert.equal("cookies" in safe, false);
  assert.equal("authorization" in safe, false);
  const wall = (safe as { wall?: Record<string, unknown> }).wall;
  assert.ok(wall, "the log-safe wall survey must survive the sanitizer");
  assert.equal(wall.pathCategory, "login");
  assert.equal(wall.authDialogCount, SURVEY_LOGIN_PAGE.authDialogCount);
  assert.ok((safe as { dismissal?: Record<string, unknown> }).dismissal);
});
