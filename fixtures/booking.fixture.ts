import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { test as base } from './api.fixture';
import { cleanupOwnedBooking, isBookingId, type BookingOwnership, type BookingPayload } from '../support/bookingLifecycle';

interface OwnedBooking {
  readonly payload: BookingPayload;
  beginCreation(): void;
  recordCreatedId(id: number): void;
}

export const test = base.extend<{ ownedBooking: OwnedBooking }>({
  ownedBooking: [async ({ request, apiAuth }, use, testInfo) => {
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
    await use({
      payload,
      beginCreation() {
        assert(!ownership.attempted, 'Booking creation must be dispatched only once per test');
        ownership.attempted = true;
      },
      recordCreatedId(id) {
        assert(ownership.attempted && isBookingId(id), 'Record a valid ID after beginning creation');
        assert(ownership.id === undefined, 'A booking ID is already registered');
        ownership.id = id;
      },
    });

    // Playwright resumes after use even when the body fails or times out.
    // Fixture teardown has its own deadline and preserves the body's error.
    let cleanup: object = { outcome: 'unresolved' };
    try {
      cleanup = await cleanupOwnedBooking(request, ownership, apiAuth.headers);
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
