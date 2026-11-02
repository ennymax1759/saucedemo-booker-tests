import assert from 'node:assert/strict';

export interface BookingPayload {
  firstname: string;
  lastname: string;
  totalprice: number;
  depositpaid: boolean;
  bookingdates: { checkin: string; checkout: string };
  additionalneeds: string;
}

export interface BookingOwnership {
  firstname: string;
  lastname: string;
  attempted: boolean;
  id?: number;
}

interface CleanupResponse {
  status(): number;
  json(): Promise<unknown>;
}

// The narrow interface also allows lifecycle failure paths to be checked offline.
export interface CleanupRequest {
  get(url: string, options: object): Promise<CleanupResponse>;
  delete(url: string, options: object): Promise<CleanupResponse>;
}

export interface CleanupOutcome {
  outcome: 'not-created' | 'not-found' | 'already-absent' | 'deleted';
  bookingId?: number;
  deletionStatus?: number;
  verificationStatus?: number;
}

const cleanupOptions = { timeout: 5_000, maxRetries: 0, maxRedirects: 0 };

export function isBookingId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export async function cleanupOwnedBooking(
  request: CleanupRequest,
  owner: BookingOwnership,
): Promise<CleanupOutcome> {
  if (!owner.attempted) return { outcome: 'not-created' };

  let id = owner.id;
  if (!isBookingId(id)) {
    // Reconcile a lost/malformed POST response; never replay booking creation.
    const lookup = await request.get('/booking', {
      ...cleanupOptions,
      params: { firstname: owner.firstname, lastname: owner.lastname },
    });
    assert.equal(lookup.status(), 200, 'Cleanup: ownership search must succeed');
    const matches = await lookup.json();
    assert(Array.isArray(matches), 'Cleanup: expected an array of booking IDs');
    if (matches.length === 0) return { outcome: 'not-found' };
    assert.equal(matches.length, 1, 'Cleanup: ambiguous ownership; refusing deletion');
    id = matches[0]?.bookingid;
    assert(isBookingId(id), 'Cleanup: invalid booking ID; refusing deletion');
  }

  const path = `/booking/${id}`;
  const existing = await request.get(path, cleanupOptions);
  if (existing.status() === 404) return { outcome: 'already-absent', bookingId: id };
  assert.equal(existing.status(), 200, `Cleanup: GET ${path} must succeed`);
  const record = await existing.json() as Partial<BookingPayload> | null;
  assert.equal(record?.firstname, owner.firstname, 'Cleanup: first name ownership mismatch; refusing deletion');
  assert.equal(record?.lastname, owner.lastname, 'Cleanup: unique surname mismatch; refusing deletion');

  const deleted = await request.delete(path, {
    ...cleanupOptions,
    // Documented public demo credentials, never included in lifecycle attachments.
    headers: { Authorization: `Basic ${Buffer.from('admin:password123').toString('base64')}` },
  });
  assert.equal(deleted.status(), 201, `Cleanup: DELETE ${path} must return 201`);
  const afterDeletion = await request.get(path, cleanupOptions);
  assert.equal(afterDeletion.status(), 404, `Cleanup: GET ${path} must confirm deletion`);
  return { outcome: 'deleted', bookingId: id, deletionStatus: 201, verificationStatus: 404 };
}
