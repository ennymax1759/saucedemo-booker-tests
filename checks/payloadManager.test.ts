import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BookingPayloadManager } from '../support/payloads/BookingPayloadManager';

void test('BookingPayloadManager creates a default valid booking with unique surname', () => {
  const payload1 = BookingPayloadManager.createDefault();
  const payload2 = BookingPayloadManager.createDefault();

  assert.equal(payload1.firstname, 'Playwright');
  assert.equal(payload1.totalprice, 245);
  assert.equal(payload1.depositpaid, true);
  assert.equal(payload1.additionalneeds, 'Breakfast');
  assert.ok(payload1.lastname.startsWith('Acceptance-'), 'Surname should have Acceptance- prefix');
  assert.notEqual(payload1.lastname, payload2.lastname, 'Each default payload must have a unique surname');
});

void test('BookingPayloadManager allows overrides on default payload', () => {
  const payload = BookingPayloadManager.createDefault({
    firstname: 'CustomUser',
    totalprice: 500,
  });

  assert.equal(payload.firstname, 'CustomUser');
  assert.equal(payload.totalprice, 500);
  assert.equal(payload.depositpaid, true);
});

void test('BookingPayloadManager creates VIP and budget templates', () => {
  const vip = BookingPayloadManager.createVipBooking();
  assert.equal(vip.firstname, 'VIP-Guest');
  assert.equal(vip.totalprice, 999);
  assert.ok(vip.additionalneeds.includes('Penthouse'));

  const budget = BookingPayloadManager.createBudgetBooking();
  assert.equal(budget.firstname, 'Budget-Guest');
  assert.equal(budget.totalprice, 50);
  assert.equal(budget.depositpaid, false);
});

void test('BookingPayloadManager generates partial update and date ranges', () => {
  const partial = BookingPayloadManager.createPartialUpdate({
    totalprice: 120,
    additionalneeds: 'Late Checkout',
  });
  assert.equal(partial.totalprice, 120);
  assert.equal(partial.additionalneeds, 'Late Checkout');

  const dates = BookingPayloadManager.createDates(2, 5);
  assert.match(dates.checkin, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(dates.checkout, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(dates.checkout > dates.checkin, 'Checkout must be after checkin');
});
