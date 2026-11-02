import assert from 'node:assert/strict';
import { isBookingId } from './bookingLifecycle';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCreatedBooking(value: unknown): { bookingid: number; booking: Record<string, unknown> } {
  assert(isObject(value), 'POST /booking must return an object');
  assert(isBookingId(value.bookingid), 'POST /booking must return a positive safe-integer booking ID');
  assert(isObject(value.booking), 'POST /booking must return a booking object');
  return { bookingid: value.bookingid, booking: value.booking };
}

export function parseAuthToken(value: unknown): string {
  assert(isObject(value), 'POST /auth must return an object');
  assert(typeof value.token === 'string' && value.token.trim().length > 0,
    'POST /auth must return a non-empty token');
  return value.token;
}
