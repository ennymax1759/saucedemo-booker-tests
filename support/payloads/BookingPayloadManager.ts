import { randomUUID } from 'node:crypto';
import type { BookingPayload } from '../bookingLifecycle';

export interface BookingDates {
  checkin: string;
  checkout: string;
}

export type PartialBookingPayload = Partial<Omit<BookingPayload, 'bookingdates'>> & {
  bookingdates?: Partial<BookingDates>;
};

/**
 * Manages API request payloads for the Booker API.
 * Provides default generation, templates, custom overrides, and partial updates.
 */
export class BookingPayloadManager {
  /**
   * Generates a valid booking payload with a uniquely marked surname.
   * The unique marker ensures test isolation and safe cleanup.
   */
  static createDefault(overrides?: Partial<BookingPayload>): BookingPayload {
    return {
      firstname: 'Playwright',
      lastname: `Acceptance-${randomUUID()}`,
      totalprice: 245,
      depositpaid: true,
      bookingdates: {
        checkin: '2027-01-10',
        checkout: '2027-01-13',
      },
      additionalneeds: 'Breakfast',
      ...overrides,
    };
  }

  /**
   * Generates a VIP-tier booking payload template.
   */
  static createVipBooking(overrides?: Partial<BookingPayload>): BookingPayload {
    return this.createDefault({
      firstname: 'VIP-Guest',
      totalprice: 999,
      depositpaid: true,
      additionalneeds: 'Late Checkout, Penthouse Suite, Champagne',
      ...overrides,
    });
  }

  /**
   * Generates a budget-tier booking payload template.
   */
  static createBudgetBooking(overrides?: Partial<BookingPayload>): BookingPayload {
    return this.createDefault({
      firstname: 'Budget-Guest',
      totalprice: 50,
      depositpaid: false,
      additionalneeds: 'None',
      ...overrides,
    });
  }

  /**
   * Generates a partial booking update payload for PATCH operations.
   */
  static createPartialUpdate(updates: PartialBookingPayload): PartialBookingPayload {
    return { ...updates };
  }

  /**
   * Constructs ISO date strings (YYYY-MM-DD) with configurable offsets.
   */
  static createDates(checkinOffsetDays = 1, durationDays = 3): BookingDates {
    const baseDate = new Date();
    const checkin = new Date(baseDate.getTime() + checkinOffsetDays * 86_400_000);
    const checkout = new Date(checkin.getTime() + durationDays * 86_400_000);
    return {
      checkin: checkin.toISOString().split('T')[0] ?? '2027-01-10',
      checkout: checkout.toISOString().split('T')[0] ?? '2027-01-13',
    };
  }
}
