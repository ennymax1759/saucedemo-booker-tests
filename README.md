# Playwright UI and API tests

Standalone TypeScript project for [Sauce Demo](https://www.saucedemo.com/) and
[Restful-booker](https://restful-booker.herokuapp.com/apidoc/index.html).
Requires Node.js 22.13+ on the 22.x line or Node.js 24+, npm, and internet access
to both public demos. This range includes the lint tooling's runtime requirements.

## Install and run

From this folder:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

On Linux, use `npx playwright install --with-deps chromium` if browser system
dependencies are missing. The lockfile pins the dependency versions.

Other commands:

```sh
npm run test:list   # Discover exactly two tests without executing them
npm run test:ui     # UI test only, headless Chromium
npm run test:api    # API test only, no browser required
npm run check      # Lint, strict TypeScript, offline checks, and discovery
npm run test:unit  # Offline lifecycle checks; no public-demo requests
npm run test:stability # Five fresh runs of each external test; 10 executions
npm run typecheck
npm run report     # Open the HTML report after execution
```

## Coverage and design

- `tests/ui/checkout.spec.ts`: logs in as `standard_user` / `secret_sauce`,
  reads the Backpack and Bike Light prices from their inventory cards, adds
  both products, verifies each checkout row's name, quantity and price, compares
  **Item total** with the sum of the original page prices, then clicks Finish
  and asserts the order confirmation. Prices use integer cents; no expected
  product price or subtotal is hardcoded. Item total excludes tax.
- `pages/SauceDemoPage.ts`: Page Object for login, adding products, checkout,
  subtotal assertions, and order completion. Rows are matched by exact product
  name, without imposing an unnecessary display-order requirement. Locators are
  scoped; actions auto-wait; quantity, price and subtotal use web-first assertions.
  There are no fixed waits, forced clicks or positional selector fallbacks.
- `tests/api/booking.spec.ts`: uses Playwright's built-in `request` fixture to
  POST a booking, then GET it by the returned ID. Deep equality verifies every
  submitted field, including nested dates, boolean deposit, numeric price and
  additional needs, in both the creation response and the fetched record.
  Each run has a unique surname. `fixtures/booking.fixture.ts` owns teardown,
  with a separate 30-second budget, even if the test body fails or times out.
  `support/bookingLifecycle.ts` verifies both ownership fields before deletion,
  deletes only that booking using documented public demo credentials, and checks
  for 404 afterward. If creation loses its response or returns a malformed ID,
  teardown searches by the unique name; zero matches cause no deletion, and
  multiple matches or an ownership mismatch fail safely. POST is never replayed.
  Cleanup errors fail the test and remain visible alongside any original failure.
- Separate projects select each test once. One worker and zero retries avoid
  silently repeating booking creation. Requests have explicit timeouts, zero
  transport retries and no redirect replay. There are no mocks in the two external
  tests, setup dependencies, ZoneQA credentials, or payment operations. The API creates one
  disposable public-demo booking per run; the UI submits one demo order.
- Steps identify each journey phase. HTML reports go to `playwright-report/`,
  JSON results to `artifacts/results.json`, and failure screenshots to
  `test-results/`; all are ignored. API results include a `booking-lifecycle`
  attachment with the synthetic ownership marker, booking ID and cleanup outcome.
  Tracing is disabled to avoid retaining authentication payloads.
- ESLint rejects fixed Playwright waits, focused/skipped tests and unawaited
  Playwright operations. Type-aware rules also catch floating/misused promises.
  Strict TypeScript and `failOnFlakyTests` are enabled. The patched `minimatch`
  override addresses [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  in the lint tooling; remove it when upstream dependencies use a patched version.
- The 14 offline checks use controlled transports and a loopback HTTP server to
  test ownership refusal, ambiguous/malformed creation recovery, failed deletion,
  and the actual fixture's timeout/error handling. They exercise framework
  mechanisms, not product correctness, and are outside the two external tests.

The demos are shared external services. Outages or periodic booking resets can
fail a run. The API cannot atomically verify ownership and delete a record; a
reset between those calls remains an external race. A write completing after
the bounded recovery lookup can also remain unresolved. Inspect the lifecycle
attachment and reconcile the unique marker rather than replaying POST. No finite
repeat run guarantees the absence of all future flakes.

`npm run test:stability` uses five fresh browser contexts and five distinct
booking identities with verified cleanup. It dispatches up to five demo orders
and five booking creations, with no retries. Discovery is available first with
`npm run test:stability -- --list --reporter=list`. The `test:list` script also
uses only the list reporter so discovery preserves the last execution reports.

## Verification

Verified on Windows on 2 November 2026 with Node.js 25.2.1 and Playwright 1.64.1:

- Independent review identified and rechecked the cleanup deadline/error handling
  and unnecessary row-order dependency; no blocking findings remained.
- `npm run check`: lint and strict TypeScript passed; **14 offline checks passed**;
  discovery selected exactly two external tests, one per project.
- `npm audit --audit-level=moderate`: **zero vulnerabilities**.
- `npm run test:stability`: **10 passed (25.1s)**: five UI checkouts and five API
  round trips, one worker, zero retries, zero failures/flaky results/skips.
  All five lifecycle attachments confirmed DELETE 201 followed by GET 404.

No flakiness was observed in these five repetitions per test. Other browsers,
operating systems, worker counts and long-term reliability were not verified.
The earlier initial project run passed both tests in 6.6 seconds after its browser
installation completed; the figures above describe the reviewed implementation.

Design references: [Playwright best practices](https://playwright.dev/docs/best-practices),
[fixture teardown](https://playwright.dev/docs/test-fixtures), and
[timeout budgets](https://playwright.dev/docs/test-timeouts).

## Observed defects / questionable behaviours

Both findings were reproduced on **2 November 2026** using Chromium and
`standard_user` on Sauce Demo. These are proposed business expectations for a
checkout flow; the demo may intentionally permit these behaviours. Neither is
silently treated as a passing regression check in the two requested tests.

### 1. Checkout succeeds with an empty cart

**Severity:** Medium — an order confirmation can be produced without any items.

**Steps:**

1. Open a fresh browser context and log in with `standard_user` / `secret_sauce`.
2. Do not add any products. Open the cart icon and click **Checkout**.
3. Enter `Test`, `Shopper`, and `10001` in the checkout information fields.
4. Click **Continue**, then **Finish**.

**Expected:** Checkout is blocked for an empty cart and explains that at least
one item is required.

**Actual:** The overview contains no products and displays `Item total: $0`,
`Tax: $0.00`, and `Total: $0.00`. Finish navigates to
`/checkout-complete.html` and displays `Thank you for your order!`.

### 2. Required checkout fields accept whitespace-only values

**Severity:** Medium — an order can complete without usable recipient or
postal information.

**Steps:**

1. Log in with `standard_user` / `secret_sauce` in a fresh browser context.
2. Add **Sauce Labs Backpack**, open the cart, and click **Checkout**.
3. Enter exactly three spaces in each of **First Name**, **Last Name**, and
   **Zip/Postal Code**.
4. Click **Continue**, then **Finish**.

**Expected:** Trim leading/trailing whitespace and reject fields that are
empty after trimming, with a visible validation error.

**Actual:** Continue opens `/checkout-step-two.html`. Finish opens
`/checkout-complete.html` and displays `Thank you for your order!`; no
validation error blocks the whitespace-only details.
