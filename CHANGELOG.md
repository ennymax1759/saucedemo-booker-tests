# Changelog

## 2026-11-02 — Authentication and test lifecycle fixtures

Implementation: [`1c0695a`](https://github.com/ennymax1759/saucedemo-booker-tests/commit/1c0695afb69acf58effbaaa649d02ceb6428a398).

### Added

- `fixtures/ui.fixture.ts`: test-scoped UI login, an overridable credentials
  option, a fresh Page Object, an empty-cart precondition, and fresh checkout data.
  Teardown attaches the test outcome and final page path; Playwright owns context
  closure on success, failure, or timeout.
- `fixtures/api.fixture.ts`: fresh token authentication through `/auth`, response
  status/content-type validation, and an in-memory authentication header for
  protected cleanup. Tokens are not written to files or lifecycle attachments.
- `support/apiResponses.ts`: runtime validation for authentication responses and
  booking creation envelopes, including positive safe-integer booking IDs.
- Offline checks for malformed responses, failed authentication, missing-ID
  recovery through the real fixture, and token-safe cleanup diagnostics.
- `docs/framework.md`: fixture dependencies, before/after responsibilities,
  safeguards, verification evidence, and shared-service limitations.

### Changed

- The UI test consumes login and checkout fixtures, reads each product price from
  the page, and retains exact item, quantity, price, subtotal, and confirmation
  assertions. Product actions remain sequential and use no fixed waits.
- Booking ownership state is private to its fixture. `beginCreation()` and
  `recordCreatedId()` replace direct state mutation and guard duplicate attempts.
- Booking cleanup uses the API token, verifies ownership before deletion, and
  confirms GET returns 404 afterward. It retains its independent timeout and
  read-only recovery lookup without replaying creation.
- DELETE transport errors are sanitized to prevent authentication-header leaks.
- The API test consumes runtime-validated response data without a non-null ID
  assertion; deep equality still verifies every submitted booking field.
- ESLint recognizes the UI assertion helpers within the checkout spec.
- README setup, run commands, test descriptions, and both original defect reports
  remain together, with detailed framework notes moved to the linked document.

### Verified

On Windows with Node.js 25.2.1 and Playwright 1.64.1:

- `npm run check`: lint and strict TypeScript passed; 20 offline checks passed;
  exactly two acceptance tests discovered.
- `npm run test:stability`: 10/10 executions passed in 23.8 seconds, five per
  acceptance test, with one worker and zero retries, failures, flakes, or skips.
- `npm test` in the main project: 2/2 passed in 5.0 seconds.
- All six bookings from those live runs were deleted and confirmed absent.
- `npm audit --audit-level=moderate`: zero reported vulnerabilities.

These observations cover the tested Windows/Chromium configuration. Shared-demo
outages, resets, and non-atomic ownership/deletion remain external limitations.
