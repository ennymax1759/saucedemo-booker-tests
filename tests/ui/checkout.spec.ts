import { test } from '../../fixtures/ui.fixture';
import type { PricedProduct } from '../../pages/SauceDemoPage';

test('checks out two products with an Item total equal to their displayed prices', async ({ authenticatedShop: shop, checkoutData }) => {
  const products = await test.step('Read inventory prices and add the two requested products', async () => {
    const selected: PricedProduct[] = [];
    for (const name of checkoutData.productNames) {
      selected.push({ name, price: await shop.addProduct(name) });
    }
    await shop.expectCartCount(selected.length);
    return selected;
  });

  await test.step('Verify both checkout rows and the Item total', async () => {
    await shop.checkout(checkoutData.customer);
    await shop.expectOrderItems(products);
    await shop.expectItemTotal(products.reduce((sum, product) => sum + product.price, 0));
  });

  await test.step('Finish checkout and verify order confirmation', async () => {
    await shop.finishCheckout();
  });
});
