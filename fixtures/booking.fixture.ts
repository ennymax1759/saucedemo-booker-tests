import assert from 'node:assert/strict';
import { test as base } from './api.fixture';
import { cleanupOwnedBooking, isBookingId, type BookingOwnership, type BookingPayload } from '../support/bookingLifecycle';
import { BookingPayloadManager } from '../support/payloads/BookingPayloadManager';
import { BookingApiHelper } from '../support/helpers/BookingApiHelper';

export interface OwnedBooking {
  readonly payload: BookingPayload;
  beginCreation(): void;
  recordCreatedId(id: number): void;
}

export const test = base.extend<{
  ownedBooking: OwnedBooking;
  bookingApi: BookingApiHelper;
}>({
  /**
   * Service helper encapsulating REST API endpoints with attached authentication headers.
   */
  bookingApi: async ({ request, apiAuth }, use) => {
    const helper = new BookingApiHelper(request, apiAuth.headers);
    await use(helper);
  },

  /**
   * Generates a uniquely owned booking payload with automatic teardown after the test.
   */
  ownedBooking: [async ({ request, apiAuth }, use, testInfo) => {
    // Generate a unique booking payload using the payload manager
    const payload = BookingPayloadManager.createDefault();

    const ownership: BookingOwnership = {
      firstname: payload.firstname,
      lastname: payload.lastname,
      attempted: false,
    };

    // Provide the booking object to the test body
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

    // Teardown: Automatically cleanup the created booking after the test completes
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
export { BookingPayloadManager } from '../support/payloads/BookingPayloadManager';
export { BookingApiHelper } from '../support/helpers/BookingApiHelper';
