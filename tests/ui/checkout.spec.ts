import { test, expect } from '@playwright/test';
import { SauceDemoPage } from '../../pages/SauceDemoPage';

test('checks out two products with an Item total equal to their displayed prices', async ({ page }) => {
  const shop = new SauceDemoPage(page);

  await test.step('Log in with a fresh browser context', async () => {
    await shop.login('standard_user', 'secret_sauce');
  });

  const products = await test.step('Read inventory prices and add the two requested products', async () => {
    const backpack = { name: 'Sauce Labs Backpack', price: await shop.addProduct('Sauce Labs Backpack') };
    const bikeLight = { name: 'Sauce Labs Bike Light', price: await shop.addProduct('Sauce Labs Bike Light') };
    await expect(page.getByTestId('shopping-cart-badge')).toHaveText('2');
    return [backpack, bikeLight];
  });

  await test.step('Verify both checkout rows and the Item total', async () => {
    await shop.checkout({ firstName: 'Test', lastName: 'Shopper', postalCode: '10001' });
    await shop.expectOrderItems(products);
    await shop.expectItemTotal(products.reduce((sum, product) => sum + product.price, 0));
  });

  await test.step('Finish checkout and verify order confirmation', async () => {
    await shop.finishCheckout();
  });
});
