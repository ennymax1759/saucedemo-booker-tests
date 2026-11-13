# Playwright Automation Framework (UI & API)

A clean, modular, and maintainable Playwright test framework written in TypeScript. It covers end-to-end UI tests for [SauceDemo](https://www.saucedemo.com/) and API tests for [Restful-booker](https://restful-booker.herokuapp.com/).

The framework is designed around standard Playwright best practices—simple to review, easy to maintain, and straightforward to extend.

---

## Quick Start

### 1. Install dependencies
```sh
npm ci
npx playwright install chromium
```

### 2. Configure credentials
Copy the template or verify `env.local` in the project root:
```sh
cp env.local.example env.local
```
Ensure your credentials are set in `env.local`:
```env
SAUCEDEMO_USERNAME=standard_user
SAUCEDEMO_PASSWORD=secret_sauce
BOOKER_USERNAME=admin
BOOKER_PASSWORD=password123
```

### 3. Run tests
```sh
# Use local-only mode for all commands in this example (PowerShell)
$env:TESTPILOT_PUBLISH = 'local-only'

# Run all tests (UI and API)
npm test

# Run only UI tests
npm run test:ui

# Run only API tests
npm run test:api

# Run lint, typechecks, and unit test validations
npm run check

# Open test report
npm run report
```

---

## Project Structure & Architecture

```text
├── pages/                  # Page Object Models (UI locators and page actions)
│   └── SauceDemoPage.ts    # Grouped locators and actions for SauceDemo
├── fixtures/               # Test setup, session reuse, and automatic teardown
│   ├── ui.fixture.ts       # Pre-authenticated browser session and checkout data
│   ├── api.fixture.ts      # Authentication token handling for API tests
│   └── booking.fixture.ts  # Isolated booking data and automatic lifecycle cleanup
├── tests/                  # End-to-end acceptance tests
│   ├── ui/
│   │   └── checkout.spec.ts  # End-to-end SauceDemo purchase flow
│   └── api/
│       └── booking.spec.ts   # Booking creation, retrieval, and validation
├── support/                # Shared helpers and environment configuration
│   ├── env.ts              # Loads credentials dynamically from env.local
│   ├── apiResponses.ts     # Schema validators for API responses
│   └── bookingLifecycle.ts # Cleanup and deletion logic for test-created bookings
├── checks/                 # Framework stability and offline contract unit checks
├── env.local               # Local environment credentials (ignored by Git)
├── env.local.example       # Template for environment variables
└── playwright.config.ts    # Central Playwright configuration
```

---

## How to Review and Modify the Framework

### 1. Page Object Model (`pages/SauceDemoPage.ts`)
Locators are organized as `readonly` properties in the constructor and grouped logically by page section:
* **Authentication:** `usernameInput`, `passwordInput`, `loginButton`
* **Header & Navigation:** `cartLink`, `cartBadge`
* **Inventory / Catalog:** `inventoryItems`, `productRow(name)`
* **Checkout (Step 1):** `checkoutButton`, `firstNameInput`, `lastNameInput`, `postalCodeInput`, `continueButton`
* **Checkout (Step 2):** `subtotalLabel`, `finishButton`
* **Checkout (Complete):** `completeHeading`

**To add a new element:**
```ts
// 1. Declare the locator at the top of SauceDemoPage
readonly menuButton: Locator;

// 2. Initialize it in the constructor
this.menuButton = page.getByRole('button', { name: 'Open Menu' });

// 3. Add an action method
async openMenu(): Promise<void> {
  await this.menuButton.click();
}
```

### 2. Writing a New UI Test
Import `test` from `fixtures/ui.fixture`. The `authenticatedShop` fixture automatically logs in using your `env.local` credentials and verifies an empty cart:
```ts
import { test } from '../../fixtures/ui.fixture';

test('adds a product to the cart and verifies count', async ({ authenticatedShop: shop }) => {
  await shop.addProduct('Sauce Labs Backpack');
  await shop.expectCartCount(1);
});
```

### 3. Writing a New API Test
Import `test` from `fixtures/api.fixture` or `fixtures/booking.fixture`. The `apiAuth` fixture supplies an authenticated header for protected endpoints:
```ts
import { test, expect } from '../../fixtures/api.fixture';

test('fetches booking IDs', async ({ request }) => {
  const response = await request.get('/booking');
  expect(response.status()).toBe(200);
});
```

---

## Key Best Practices Implemented

1. **No Hardcoded Credentials:** All usernames and passwords live in `env.local` and are ignored by version control.
2. **User-Facing Locators:** Prefers `getByRole`, `getByPlaceholder`, and `getByTestId` over brittle XPath or CSS selectors.
3. **Resilient Assertions:** All assertions use Playwright's web-first `expect(locator)...` which automatically wait for the DOM to be ready without arbitrary sleeps.
4. **Integer Cents Precision:** Product prices are calculated in integer cents to avoid floating-point rounding errors.
5. **Automatic Cleanup:** API bookings created during tests are tracked and cleanly deleted during fixture teardown, preventing orphaned test data.

---

## Useful Commands

| Command | Purpose |
| :--- | :--- |
| `npm test` | Runs all tests and publishes to the configured Testpilot run |
| `npm run test:ui` | Runs only UI tests in Chromium |
| `npm run test:ui -- --headed` | Runs UI tests in headed browser mode |
| `npm run test:api` | Runs API tests |
| `npm run check` | Runs linting, typechecking, and contract unit tests |
| `npm run test:stability` | Runs 5 repetitions per test with zero retries to confirm stability |
| `npm run report` | Opens the Playwright HTML test report |

## Publish results to Testpilot

The reporter publishes the SauceDemo and Restful Booker results to a dedicated Testpilot project and active run.

1. Keep `testpilot-map.json` in the repo root. To recreate it, set
   `TESTPILOT_LIST_MAPPINGS=1` and `TESTPILOT_DISCOVERY_FILE=testpilot-discovery.json`,
   then run `npx playwright test --list`. Import the discovery file under
   **Automation → Mappings**, map all selected tests to their cases, and download
   `testpilot-map.json`. Clear the two discovery variables before publishing.
2. A workspace admin can create an **Unattended automation** key in
   **Settings → API keys** for CI. This key can submit results over REST and
   stays usable after sign-out while its issuer retains admin access. For a
   short local test, a **Session key** with **Submit results only** and
   **REST only** also works while the issuing session is active.
3. Create a file named `.env.testpilot` next to `playwright.config.ts` and add
   the key there once. Bind it to one destination by saving its baseURL, projectId, runId, and environment in testpilot.local-target.json. Git ignores both files. On CI, use the
   `TESTPILOT_API_KEY` secret instead.

```dotenv
TESTPILOT_API_KEY=your-results-only-key
```

Run `npm run test:ui` for SauceDemo, `npm run test:api` for Restful Booker,
or `npm test` for both. Clear TESTPILOT_PUBLISH or set it to required to publish. Set the Testpilot destination before running.
These commands check the selected case mappings before launching Playwright.
On an updated Testpilot server, they also check the target run, protected
results, and compatibility with the case's previous automation settings.
On older servers, preflight checks the key and local mappings.
To check the target without running tests, use `npm run testpilot:check`
or `npm run testpilot:check -- --project=ui-chromium`.

Playwright prints the test outcome and the confirmed report link separately.
It writes the link and counts under `artifacts/testpilot-receipts/`, adds an
**Open Testpilot report** receipt to Playwright HTML case details, and links the
saved report in the GitHub Actions job summary.
Open **Automation → Reports** to find earlier versions.

The next publishing run retries pending deliveries for the same target after
its connection check. To recover immediately, use the retry command printed
in the terminal. `npm run testpilot:retry` also lists pending deliveries or
retries the only pending delivery. Recovery reuses the original delivery ID
and retries staged attachments. Keep the pending folder private.
For a custom target, use the same Testpilot URL, project, and run settings
as the original command.

| `TESTPILOT_PUBLISH` | When to use it |
| --- | --- |
| `required` (default) | A verified target and successful upload are required. An incomplete upload fails the command, and a failing test still fails the command. |
| `best-effort` | Run the tests even if Testpilot is unavailable. Save finished results for retry after a connection failure. Upload issues leave the original Playwright exit status intact. |
| `local-only` (or `0`) | Run locally without contacting Testpilot. Use this to override `--reporter`. |

A partial receipt lists rejected case IDs and how to fix each one. Open the
saved report for the accepted cases, fix the mapping or target, and rerun the
affected tests. To keep a mapping when renaming a test, attach the case ID to
the test with an annotation `{ type: 'testpilot', description: 'TC-00000000' }`
and remove its old mapping file entry.

### Check for mapping drift

Run `npm run testpilot:mappings` after adding, moving, or renaming tests. The
command discovers the full suite without running tests or contacting Testpilot.
It reports obsolete entries, missing or invalid case IDs, conflicting
annotations, and tests mapped to the same case. Update the mappings in
**Automation → Mappings**, then run the check again.

Use `-- --project <name>` to verify one browser target while still checking
obsolete file entries against the full suite. Use `-- --json` for the complete
machine-readable result. The check exits `1` for mapping drift or `2` when
discovery or configuration fails.

### Named publishing targets

In Testpilot, open **Automation → Setup → Save a publishing target**. Select the
active run, give it a name such as `staging`, and download `testpilot.targets.json`.
Save the file beside `playwright.config.ts`. It contains the server URL, project,
run, and environment. Keep the API key in `TESTPILOT_API_KEY` separately.

The file's `defaultTarget` is used automatically. To switch in PowerShell, run
`$env:TESTPILOT_TARGET = 'staging'` before `npm run testpilot:check` or `npm test`.
To keep multiple targets, copy each downloaded entry into the same `targets`
object. Keep `defaultTarget` set to the target you use most often.

Existing URL, project, run, and environment variables still override file values.
The ignored `.env.testpilot` remains scoped to this repository's original
Testpilot destination. Supply a key for any other destination explicitly.

### Publish one report from Playwright shards

Set `TESTPILOT_BUILD` to a value unique to the pipeline attempt and set
`TESTPILOT_SHARD_DIR` to the folder for blob reports and manifests. For GitHub
Actions, the run ID and attempt number supply the build identifier by default.
Run `npm test -- --shard=1/2` and `npm test -- --shard=2/2` in separate jobs.
Upload each shard's `.zip` and `.json` files as CI artifacts, even if a test fails.
Only the merge job needs `TESTPILOT_API_KEY`. Download the artifacts into one
folder, use the same target and build settings, and run
`npm run testpilot:merge -- 2`. A missing or mismatched shard blocks publication.
Repeating the merge with the same artifacts reuses the same report.

Set `TESTPILOT_RELEASE_GATE=1` in the publishing job to require a **Ready**
decision from Testpilot. Failed or blocked cases, incomplete coverage, skipped
tests, and flaky results prevent a passing gate. The saved report remains
available for review. An unavailable gate also fails the publishing job.

### GitHub Actions

Changes to the tests or runner on `main` trigger **Playwright and Testpilot**.
Both shards run against the public demo sites and merge into a downloadable
Playwright report. To publish to Testpilot, open the workflow in **Actions**,
choose **Run workflow** on `main`, then enable **Publish**.

Use a dedicated active run containing every case in the downloaded mapping.
In **Settings → Secrets and variables → Actions**, add repository secrets
`TESTPILOT_PROJECT_ID` and `TESTPILOT_RUN_ID`. Set the repository variable
`TESTPILOT_ENVIRONMENT` to the same environment used for that run, or leave it
empty to use `CI`. In the `testpilot-publication` environment, set the secrets
`TESTPILOT_API_KEY` and `TESTPILOT_MAPPING_JSON` using a workspace-scoped
unattended key and the complete contents of the downloaded mapping file.

The publication job checks mappings, verifies each shard, and enforces
Testpilot's release gate. If a delivery is queued, the publication job retries
it once using the same shard results. GitHub artifacts contain the public
demo reports only. Open **Automation → Reports** in Testpilot to review the
published results.
If a shard needs to be rerun, choose **Re-run all jobs** so both shard reports
are regenerated for the same attempt.
