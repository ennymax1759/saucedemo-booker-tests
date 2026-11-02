import { test as base, expect } from '@playwright/test';
import { parseAuthToken } from '../support/apiResponses';

export interface ApiAuth {
  readonly headers: Readonly<Record<string, string>>;
}

export const test = base.extend<{ apiAuth: ApiAuth }>({
  apiAuth: async ({ request }, use) => {
    const response = await request.post('/auth', {
      // Documented public demo credentials; the issued token stays in memory.
      data: { username: 'admin', password: 'password123' },
      timeout: 10_000, maxRetries: 0, maxRedirects: 0,
    });
    expect(response.status(), 'POST /auth status').toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const token = parseAuthToken(await response.json());
    await use({ headers: { Cookie: `token=${token}` } });
  },
});

export { expect } from '@playwright/test';
