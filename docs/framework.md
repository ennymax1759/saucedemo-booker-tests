# Fixtures and reliability

## Before and after each test

| Fixture | Before the test | After the test |
| --- | --- | --- |
| Playwright `page` / `context` | Fresh browser session with no shared storage | Automatically closes the context on success, failure or timeout |
| `authenticatedShop` | Builds the Page Object, logs in through the real UI, verifies inventory URL and empty cart | Attaches test status and final URL path; leaves context disposal to Playwright |
| `checkoutData` | Supplies fresh product names and customer details | No external resources to clean |
| `apiAuth` | Calls `/auth`, checks status/content type, validates a token | Token remains in test-scoped memory; no token files or attachments |
| `ownedBooking` | Generates a unique payload and prepares private ownership tracking | Recovers a missing ID if needed, verifies ownership, performs authenticated DELETE, verifies 404 and attaches outcome |

Fixtures provide before/after lifecycle through `await use(...)`. Using fixture
dependencies keeps setup and teardown together and avoids duplicated hook state.
The named UI login step appears in the report for every test. Login is performed
through the UI each time; there is no stored authentication cache or setup project.
`loginCredentials` is an overridable fixture option for future roles. The
assessment uses only the required `standard_user` account.

Product selection, checkout, booking creation and fetching remain in the test
bodies. The API test explicitly calls the built-in `request` fixture. Restful-booker
creation and reading are public endpoints; the token protects DELETE. It is sent
only on that protected call, with no redirect replay or transport retries.

The booking test calls `beginCreation()` before POST and `recordCreatedId()` after
runtime response validation. These methods enforce one creation attempt and keep
mutable ownership state private. `parseCreatedBooking()` accepts `unknown` JSON,
checks the envelope, positive safe-integer ID and booking object, and returns a
typed ID. Deep equality in the test verifies all booking fields and types.

## Safeguards and reporting

- UI products are matched by exact name, with exact row counts, quantities and
  original inventory prices. Integer cents avoid floating-point rounding.
- Locator assertions wait for the observable UI. No fixed waits or force clicks.
- One worker, zero test retries, explicit request deadlines and no mutation replay.
- API teardown has its own 30-second budget; each cleanup request is bounded to
  five seconds. It still runs when the test body fails or times out.
- A lost/malformed creation response triggers a read-only lookup by the unique
  marker. Zero matches cause no deletion; ambiguous results or ownership mismatch
  fail safely. Only the single verified owned record may be deleted.
- Cleanup failure remains visible alongside the body's original error. UI and
  booking lifecycle attachments contain only safe metadata. DELETE transport
  errors are sanitized so request diagnostics cannot expose the token.
- Tracing is disabled; failure screenshots and HTML/JSON reports are ignored.
- ESLint rejects waits, focused/skipped tests and unawaited operations; strict
  TypeScript and promise rules are enabled. Discovery uses the list reporter to
  preserve the last execution reports.
- The patched `minimatch` override addresses
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  in lint dependencies. Revisit it once upstream dependencies adopt the patch.

## Verification

The offline checks exercise runtime response validation, authentication failure,
ownership refusal, ambiguous lookup, failed deletion, token-safe errors, and the
actual fixture's timeout/recovery/error handling through a loopback HTTP server.
They test framework mechanisms, separately from the two live acceptance tests.

Verified the fixture refactor on Windows with Node.js 25.2.1 and Playwright 1.64.1
on 2 November 2026:

- `npm run check`: lint and strict TypeScript passed; **20 offline checks passed**;
  discovery selected exactly two external tests.
- `npm run test:stability`: **10 passed in 23.8 seconds** (five repetitions per
  test), one worker, zero retries, failures, flaky results or skips.
- All five UI lifecycle attachments recorded `/checkout-complete.html`; all five
  booking attachments confirmed DELETE 201 followed by GET 404, using auth tokens.
- `npm audit --audit-level=moderate`: zero vulnerabilities.

The previous implementation passed 14 offline checks and 10/10 live executions
in 25.1 seconds. Those older figures describe the pre-fixture implementation;
the difference in live runtime is not a controlled performance benchmark.

## Limits

Shared-demo outages and resets can fail tests. The API cannot atomically verify
ownership and delete a record; a reset between those calls remains an external
race. A write that completes after the bounded recovery lookup can remain
unresolved. Inspect the unique marker rather than replaying POST. Five repetitions
per test cannot establish long-term reliability or other-browser/OS compatibility.

References: [Playwright fixtures](https://playwright.dev/docs/test-fixtures),
[best practices](https://playwright.dev/docs/best-practices), and
[timeouts](https://playwright.dev/docs/test-timeouts).
