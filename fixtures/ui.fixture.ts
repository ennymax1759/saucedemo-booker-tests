import assert from 'node:assert/strict';
import { test as base } from '@playwright/test';
import { SauceDemoPage, type CheckoutDetails } from '../pages/SauceDemoPage';
import { getSauceCredentials } from '../support/env';

export interface LoginCredentials {
  readonly username: string;
  readonly password: string;
}

export interface CheckoutData {
  readonly productNames: readonly string[];
  readonly customer: CheckoutDetails;
}

interface UiFixtures {
  /** Page Object instance pre-authenticated with session credentials from env.local */
  authenticatedShop: SauceDemoPage;
  /** Test data for products to select and customer checkout information */
  checkoutData: CheckoutData;
}

export const test = base.extend<UiFixtures & { loginCredentials: LoginCredentials }>({
  // Credentials loaded dynamically from env.local (overridable per-test via test.use())
  loginCredentials: [getSauceCredentials(), { option: true }],

  authenticatedShop: async ({ page, loginCredentials }, use, testInfo) => {
    const shop = new SauceDemoPage(page);

    await base.step('Log in through the UI in a fresh browser context', async () => {
      assert(
        loginCredentials.username && loginCredentials.password,
        'SauceDemo credentials not found. Please set SAUCEDEMO_USERNAME and SAUCEDEMO_PASSWORD in env.local.'
      );
      await shop.login(loginCredentials.username, loginCredentials.password);
      await shop.expectEmptyCart();
    });

    await use(shop);

    // Attach execution summary to report for test diagnostics
    await testInfo.attach('ui-lifecycle', {
      body: JSON.stringify({
        status: testInfo.status,
        expectedStatus: testInfo.expectedStatus,
        finalPath: new URL(page.url()).pathname,
      }, null, 2),
      contentType: 'application/json',
    });
  },

  checkoutData: async ({}, use) => {
    await use({
      productNames: ['Sauce Labs Backpack', 'Sauce Labs Bike Light'],
      customer: { firstName: 'Test', lastName: 'Shopper', postalCode: '10001' },
    });
  },
});

export { expect } from '@playwright/test';
