import { randomUUID } from 'node:crypto';
import { test as base } from '@playwright/test';
import { cleanupOwnedBooking, type BookingOwnership, type BookingPayload } from '../support/bookingLifecycle';

interface OwnedBooking {
  payload: BookingPayload;
  ownership: BookingOwnership;
}

export const test = base.extend<{ ownedBooking: OwnedBooking }>({
  ownedBooking: [async ({ request }, use, testInfo) => {
    const payload: BookingPayload = {
      firstname: 'Playwright',
      lastname: `Acceptance-${randomUUID()}`,
      totalprice: 245,
      depositpaid: true,
      bookingdates: { checkin: '2027-01-10', checkout: '2027-01-13' },
      additionalneeds: 'Breakfast',
    };
    const ownership: BookingOwnership = {
      firstname: payload.firstname, lastname: payload.lastname, attempted: false,
    };
    await use({ payload, ownership });

    // Playwright resumes after use even when the body fails or times out.
    // Fixture teardown has its own deadline and preserves the body's error.
    let cleanup: object = { outcome: 'unresolved' };
    try {
      cleanup = await cleanupOwnedBooking(request, ownership);
    } catch (error) {
      cleanup = { outcome: 'unresolved', reason: 'See the cleanup failure in the test report' };
      throw error;
    } finally {
      await testInfo.attach('booking-lifecycle', {
        body: JSON.stringify({ marker: ownership.lastname, bookingId: ownership.id, ...cleanup }, null, 2),
        contentType: 'application/json',
      });
    }
  }, { timeout: 30_000 }],
});

export { expect } from '@playwright/test';
