import type { APIRequestContext } from '@playwright/test';
import { parseCreatedBooking } from '../apiResponses';
import type { BookingPayload } from '../bookingLifecycle';
import type { PartialBookingPayload } from '../payloads/BookingPayloadManager';

export interface ApiResponse<T> {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly data: T;
}

export interface CreateBookingResponse extends ApiResponse<{ bookingid: number; booking: Record<string, unknown> }> {
  readonly bookingId: number;
}

const DEFAULT_OPTIONS = {
  timeout: 10_000,
  maxRetries: 0,
  maxRedirects: 0,
};

/**
 * Service helper encapsulating Booker API HTTP endpoints.
 * Handles request dispatching, header assembly, and typed response extraction.
 */
export class BookingApiHelper {
  constructor(
    private readonly request: APIRequestContext,
    private readonly authHeaders: Readonly<Record<string, string>> = {},
  ) {}

  /**
   * Dispatches POST /booking to create a new booking record.
   */
  async createBooking(payload: BookingPayload): Promise<CreateBookingResponse> {
    const response = await this.request.post('/booking', {
      ...DEFAULT_OPTIONS,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders,
      },
    });

    const headers = response.headers();
    const json = (await response.json()) as unknown;
    const parsed = parseCreatedBooking(json);

    return {
      status: response.status(),
      headers,
      data: parsed,
      bookingId: parsed.bookingid,
    };
  }

  /**
   * Dispatches GET /booking/{id} to fetch a booking by identifier.
   */
  async getBooking(bookingId: number): Promise<ApiResponse<BookingPayload>> {
    const response = await this.request.get(`/booking/${bookingId}`, {
      ...DEFAULT_OPTIONS,
      headers: {
        Accept: 'application/json',
      },
    });

    const headers = response.headers();
    const data = (await response.json()) as BookingPayload;

    return {
      status: response.status(),
      headers,
      data,
    };
  }

  /**
   * Dispatches GET /booking to query bookings by filter criteria.
   */
  async getBookingIds(params?: {
    firstname?: string;
    lastname?: string;
    checkin?: string;
    checkout?: string;
  }): Promise<ApiResponse<Array<{ bookingid: number }>>> {
    const response = await this.request.get('/booking', {
      ...DEFAULT_OPTIONS,
      params,
      headers: {
        Accept: 'application/json',
      },
    });

    const headers = response.headers();
    const data = (await response.json()) as Array<{ bookingid: number }>;

    return {
      status: response.status(),
      headers,
      data,
    };
  }

  /**
   * Dispatches PUT /booking/{id} to overwrite an entire booking record.
   */
  async updateBooking(
    bookingId: number,
    payload: BookingPayload,
  ): Promise<ApiResponse<BookingPayload>> {
    const response = await this.request.put(`/booking/${bookingId}`, {
      ...DEFAULT_OPTIONS,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.authHeaders,
      },
    });

    const headers = response.headers();
    const data = (await response.json()) as BookingPayload;

    return {
      status: response.status(),
      headers,
      data,
    };
  }

  /**
   * Dispatches PATCH /booking/{id} to update select fields of a booking.
   */
  async partialUpdateBooking(
    bookingId: number,
    payload: PartialBookingPayload,
  ): Promise<ApiResponse<BookingPayload>> {
    const response = await this.request.patch(`/booking/${bookingId}`, {
      ...DEFAULT_OPTIONS,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.authHeaders,
      },
    });

    const headers = response.headers();
    const data = (await response.json()) as BookingPayload;

    return {
      status: response.status(),
      headers,
      data,
    };
  }

  /**
   * Dispatches DELETE /booking/{id} to delete a booking record.
   */
  async deleteBooking(bookingId: number): Promise<Omit<ApiResponse<never>, 'data'>> {
    const response = await this.request.delete(`/booking/${bookingId}`, {
      ...DEFAULT_OPTIONS,
      headers: {
        ...this.authHeaders,
      },
    });

    return {
      status: response.status(),
      headers: response.headers(),
    };
  }
}
