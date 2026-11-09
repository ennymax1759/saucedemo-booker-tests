import { test as base, expect } from '@playwright/test';
import { parseAuthToken } from '../support/apiResponses';
import { getBookerCredentials } from '../support/env';

export interface ApiAuth {
  /** Authentication headers containing the session cookie token */
  readonly headers: Readonly<Record<string, string>>;
}

export const test = base.extend<{ apiAuth: ApiAuth }>({
  apiAuth: async ({ request }, use) => {
    // Authenticate using credentials configured in env.local
    const response = await request.post('/auth', {
      data: getBookerCredentials(),
      timeout: 10_000,
      maxRetries: 0,
      maxRedirects: 0,
    });
    expect(response.status(), 'POST /auth status').toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const token = parseAuthToken(await response.json());
    await use({ headers: { Cookie: `token=${token}` } });
  },
});

export { expect } from '@playwright/test';
