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
| `npm test` | Runs all UI and API tests |
| `npm run test:ui` | Runs only UI tests in Chromium |
| `npm run test:ui -- --headed` | Runs UI tests in headed browser mode |
| `npm run test:api` | Runs API tests |
| `npm run check` | Runs linting, typechecking, and contract unit tests |
| `npm run test:stability` | Runs 5 repetitions per test with zero retries to confirm stability |
| `npm run report` | Opens the Playwright HTML test report |
