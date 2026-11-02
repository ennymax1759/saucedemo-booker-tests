# Playwright UI and API assessment

Two TypeScript acceptance tests for [Sauce Demo](https://www.saucedemo.com/)
and [Restful-booker](https://restful-booker.herokuapp.com/apidoc/index.html).
Use Node.js 22.13+ on the 22.x line or Node.js 24+, with npm and internet access.

## Install and run

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

On Linux, install browser dependencies with `npx playwright install --with-deps chromium`.
To watch the checkout, run `npm run test:ui -- --headed`.

| Command | Purpose |
| --- | --- |
| `npm run test:ui` | One Chromium checkout test |
| `npm run test:api` | One API round-trip test; no browser required |
| `npm run check` | Lint, strict types, offline framework checks and discovery |
| `npm run test:list` | Discover the two acceptance tests without running them |
| `npm run test:stability` | Five fresh runs per acceptance test, zero retries |
| `npm run report` | Open the latest HTML report |

## What the tests verify

- **UI:** a fixture logs in as `standard_user` / `secret_sauce` in a fresh context
  and verifies an empty cart. The test adds Backpack and Bike Light, checks both
  checkout rows, compares Item total against the prices read from the page in
  integer cents, and verifies order confirmation. No hardcoded prices or fixed waits.
- **API:** an auth fixture obtains a token from `/auth`. The test uses the built-in
  `request` fixture to create a unique booking and fetch it by ID, comparing every
  field with deep equality. Teardown checks ownership, deletes the booking using
  the token, and verifies 404, including after a test failure or timeout.
- Page Objects handle UI interactions and assertions. Fixtures own login, fresh
  checkout/booking data, authentication and teardown; business actions remain in
  the tests. Both acceptance tests run against the real demos without mocks.

Reports: `playwright-report/`, `artifacts/results.json`, and failure screenshots
in `test-results/`. Lifecycle attachments record UI outcome and booking cleanup
without tokens. Generated artifacts are ignored by Git.

See [fixture design, safeguards and verification](docs/framework.md) for details.
Shared-demo outages or resets can fail a run; successful repetitions do not
prove universal freedom from flakes.

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
