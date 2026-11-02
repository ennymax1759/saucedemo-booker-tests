import { test, expect } from '../../fixtures/booking.fixture';
import { parseCreatedBooking } from '../../support/apiResponses';

test('creates a booking and fetches every submitted field unchanged', async ({ request, ownedBooking }) => {
  const { payload } = ownedBooking;

  const bookingId = await test.step('Create one uniquely owned booking', async () => {
    ownedBooking.beginCreation();
    const created = await request.post('/booking', {
      data: payload, timeout: 10_000, maxRetries: 0, maxRedirects: 0,
    });
    expect(created.status(), 'POST /booking status').toBe(200);
    expect(created.headers()['content-type']).toContain('application/json');
    const result = parseCreatedBooking(await created.json());
    // Teardown can recover by marker even when the response cannot provide an ID.
    ownedBooking.recordCreatedId(result.bookingid);
    expect(result.booking, 'Every field in the creation response').toEqual(payload);
    return result.bookingid;
  });

  await test.step('Fetch by ID and compare every submitted field', async () => {
    const fetched = await request.get(`/booking/${bookingId}`, {
      timeout: 10_000, maxRetries: 0, maxRedirects: 0,
    });
    expect(fetched.status(), `GET /booking/${bookingId} status`).toBe(200);
    expect(fetched.headers()['content-type']).toContain('application/json');
    expect(await fetched.json(), 'Full persisted booking, including nested dates and types').toEqual(payload);
  });
});
