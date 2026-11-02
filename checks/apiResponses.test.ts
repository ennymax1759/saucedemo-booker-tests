import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCreatedBooking, parseAuthToken } from '../support/apiResponses';

void test('creation parser returns a validated numeric ID and preserves the entire booking', () => {
  const booking = { firstname: 'Test', bookingdates: { checkin: '2027-01-10' }, extra: true };
  assert.deepEqual(parseCreatedBooking({ bookingid: 42, booking }), { bookingid: 42, booking });
});

void test('creation parser rejects missing/malformed IDs, envelopes and booking objects', () => {
  for (const value of [null, [], 'invalid', {},
    { bookingid: '42', booking: {} }, { bookingid: -1, booking: {} },
    { bookingid: 1.5, booking: {} }, { bookingid: Number.MAX_SAFE_INTEGER + 1, booking: {} },
    { bookingid: 42 }, { bookingid: 42, booking: null }, { bookingid: 42, booking: [] }]) {
    assert.throws(() => parseCreatedBooking(value));
  }
});

void test('auth parser accepts a non-empty token and rejects unsuccessful authentication', () => {
  assert.equal(parseAuthToken({ token: 'offline-token' }), 'offline-token');
  for (const value of [null, [], {}, { reason: 'Bad credentials' },
    { token: 42 }, { token: '' }, { token: '   ' }]) {
    assert.throws(() => parseAuthToken(value));
  }
});
