import { test as base } from '@playwright/test';
import { SauceDemoPage, type CheckoutDetails } from '../pages/SauceDemoPage';

interface LoginCredentials {
  readonly username: string;
  readonly password: string;
}

interface CheckoutData {
  readonly productNames: readonly string[];
  readonly customer: CheckoutDetails;
}

interface UiFixtures {
  authenticatedShop: SauceDemoPage;
  checkoutData: CheckoutData;
}

export const test = base.extend<UiFixtures & { loginCredentials: LoginCredentials }>({
  // Public demo credentials. Tests can override this option with test.use().
  loginCredentials: [{ username: 'standard_user', password: 'secret_sauce' }, { option: true }],
  authenticatedShop: async ({ page, loginCredentials }, use, testInfo) => {
    const shop = new SauceDemoPage(page);

    await base.step('Log in through the UI in a fresh browser context', async () => {
      await shop.login(loginCredentials.username, loginCredentials.password);
      await shop.expectEmptyCart();
    });

    await use(shop);

    // This teardown also runs after a body assertion fails or the body times out.
    await testInfo.attach('ui-lifecycle', {
      body: JSON.stringify({
        status: testInfo.status,
        expectedStatus: testInfo.expectedStatus,
        finalPath: new URL(page.url()).pathname,
        contextCleanup: 'Managed by the Playwright context fixture',
      }, null, 2),
      contentType: 'application/json',
    });
    // Playwright owns and closes the test-scoped page/context, even on failure.
  },
  checkoutData: async ({}, use) => {
    await use({
      productNames: ['Sauce Labs Backpack', 'Sauce Labs Bike Light'],
      customer: { firstName: 'Test', lastName: 'Shopper', postalCode: '10001' },
    });
  },
});

export { expect } from '@playwright/test';
