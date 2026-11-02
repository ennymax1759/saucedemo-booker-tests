import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  cleanupOwnedBooking as cleanup,
  isBookingId,
  type BookingOwnership,
  type CleanupRequest,
} from '../support/bookingLifecycle';

const authHeaders = { Cookie: 'token=offline-token' };
const cleanupOwnedBooking = (request: CleanupRequest, ownership: BookingOwnership) =>
  cleanup(request, ownership, authHeaders);

const owner: BookingOwnership = {
  firstname: 'Playwright', lastname: 'Acceptance-owned-run', attempted: true, id: 42,
};

type PlannedCall = {
  method: 'get' | 'delete'; url: string; status?: number; body?: unknown; error?: Error;
};
type RecordedCall = { method: 'get' | 'delete'; url: string; options: Record<string, unknown> };

function transport(plan: PlannedCall[]) {
  const calls: RecordedCall[] = [];
  const remaining = [...plan];
  async function dispatch(method: 'get' | 'delete', url: string, options: object) {
    calls.push({ method, url, options: options as Record<string, unknown> });
    const next = remaining.shift();
    assert.ok(next, `Unexpected ${method} ${url}; cleanup must stay bounded`);
    assert.equal(method, next.method);
    assert.equal(url, next.url);
    if (next.error) throw next.error;
    return { status: () => next.status!, json: async () => next.body };
  }
  const request: CleanupRequest = {
    get: (url, options) => dispatch('get', url, options),
    delete: (url, options) => dispatch('delete', url, options),
  };
  return {
    request, calls,
    verify() {
      assert.equal(remaining.length, 0, 'All expected cleanup steps must execute');
      for (const call of calls) {
        assert.equal(call.options.timeout, 5_000);
        assert.equal(call.options.maxRetries, 0);
        assert.equal(call.options.maxRedirects, 0);
      }
    },
  };
}

const ownedRecord = { firstname: owner.firstname, lastname: owner.lastname };
const deletionPlan: PlannedCall[] = [
  { method: 'get', url: '/booking/42', status: 200, body: ownedRecord },
  { method: 'delete', url: '/booking/42', status: 201 },
  { method: 'get', url: '/booking/42', status: 404 },
];

void test('booking IDs must be positive safe integers', () => {
  for (const value of [1, 42, Number.MAX_SAFE_INTEGER]) assert.equal(isBookingId(value), true);
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    '42', null, undefined, {}, true]) assert.equal(isBookingId(value), false);
});

void test('does not inspect or mutate bookings when creation was never attempted', async () => {
  const fake = transport([]);
  assert.deepEqual(await cleanupOwnedBooking(fake.request, { ...owner, attempted: false }),
    { outcome: 'not-created' });
  fake.verify();
});

void test('deletes only the verified owned booking and confirms its absence', async () => {
  const fake = transport(deletionPlan);
  assert.deepEqual(await cleanupOwnedBooking(fake.request, owner), {
    outcome: 'deleted', bookingId: 42, deletionStatus: 201, verificationStatus: 404,
  });
  const headers = fake.calls[1].options.headers as Record<string, string>;
  assert.deepEqual(headers, authHeaders, 'DELETE uses the API auth fixture token');
  fake.verify();
});

void test('recovers a lost creation response by unique owner lookup without repeating POST', async () => {
  const fake = transport([
    { method: 'get', url: '/booking', status: 200, body: [{ bookingid: 42 }] },
    ...deletionPlan,
  ]);
  const result = await cleanupOwnedBooking(fake.request, { ...owner, id: undefined });
  assert.equal(result.outcome, 'deleted');
  assert.deepEqual(fake.calls[0].options.params,
    { firstname: owner.firstname, lastname: owner.lastname });
  assert.equal(fake.calls.length, 4);
  fake.verify();
});

void test('an empty reconciliation lookup does not delete any booking', async () => {
  const fake = transport([{ method: 'get', url: '/booking', status: 200, body: [] }]);
  assert.deepEqual(await cleanupOwnedBooking(fake.request, { ...owner, id: undefined }),
    { outcome: 'not-found' });
  fake.verify();
});

void test('an already absent booking needs no DELETE', async () => {
  const fake = transport([{ method: 'get', url: '/booking/42', status: 404 }]);
  assert.deepEqual(await cleanupOwnedBooking(fake.request, owner),
    { outcome: 'already-absent', bookingId: 42 });
  fake.verify();
});

void test('refuses deletion when either ownership field differs', async () => {
  for (const body of [
    { ...ownedRecord, firstname: 'Another user' },
    { ...ownedRecord, lastname: 'Another run' },
  ]) {
    const fake = transport([{ method: 'get', url: '/booking/42', status: 200, body }]);
    await assert.rejects(cleanupOwnedBooking(fake.request, owner));
    assert.equal(fake.calls.length, 1);
    fake.verify();
  }
});

void test('refuses ambiguous reconciliation instead of choosing a booking arbitrarily', async () => {
  const fake = transport([{
    method: 'get', url: '/booking', status: 200, body: [{ bookingid: 42 }, { bookingid: 43 }],
  }]);
  await assert.rejects(cleanupOwnedBooking(fake.request, { ...owner, id: undefined }));
  assert.equal(fake.calls.length, 1);
  fake.verify();
});

void test('rejects malformed reconciliation responses before deletion', async () => {
  for (const body of [null, {}, { bookingid: 42 }, [{}], [{ bookingid: '42' }],
    [{ bookingid: -1 }], [{ bookingid: Number.MAX_SAFE_INTEGER + 1 }]]) {
    const fake = transport([{ method: 'get', url: '/booking', status: 200, body }]);
    await assert.rejects(cleanupOwnedBooking(fake.request, { ...owner, id: undefined }));
    assert.equal(fake.calls.length, 1);
    fake.verify();
  }
});

void test('transport and lookup status failures remain visible without retries', async () => {
  for (const response of [{ status: 503 }, { error: new Error('network unavailable') }]) {
    const fake = transport([{ method: 'get', url: '/booking/42', ...response }]);
    await assert.rejects(cleanupOwnedBooking(fake.request, owner));
    assert.equal(fake.calls.length, 1);
    fake.verify();
  }
});

void test('failed DELETE does not become a successful cleanup or retry', async () => {
  const fake = transport([
    deletionPlan[0], { method: 'delete', url: '/booking/42', status: 403 },
  ]);
  await assert.rejects(cleanupOwnedBooking(fake.request, owner));
  assert.equal(fake.calls.length, 2);
  fake.verify();
});

void test('a successful DELETE is insufficient if the booking remains readable', async () => {
  const fake = transport([
    deletionPlan[0], deletionPlan[1],
    { method: 'get', url: '/booking/42', status: 200, body: ownedRecord },
  ]);
  await assert.rejects(cleanupOwnedBooking(fake.request, owner));
  assert.equal(fake.calls.length, 3);
  fake.verify();
});

void test('DELETE transport failures do not leak token-bearing request diagnostics', async () => {
  const fake = transport([
    deletionPlan[0], { method: 'delete', url: '/booking/42', error: new Error('Cookie: token=offline-token') },
  ]);
  await assert.rejects(cleanupOwnedBooking(fake.request, owner), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /deletion outcome unresolved/);
    assert.doesNotMatch(error.message, /offline-token|Cookie/);
    return true;
  });
  assert.equal(fake.calls.length, 2);
  fake.verify();
});
