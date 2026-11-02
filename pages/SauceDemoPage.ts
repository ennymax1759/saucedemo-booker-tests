import { expect, type Locator, type Page } from '@playwright/test';

export interface CheckoutDetails {
  readonly firstName: string;
  readonly lastName: string;
  readonly postalCode: string;
}

export interface PricedProduct {
  readonly name: string;
  readonly price: number;
}

// Work in integer cents so floating-point rounding cannot mask a price error.
export function priceInCents(text: string): number {
  const match = text.trim().match(/^\$(\d+)\.(\d{2})$/);
  if (!match) throw new Error(`Unexpected price format: ${JSON.stringify(text)}`);
  const cents = Number(match[1]) * 100 + Number(match[2]);
  if (!Number.isSafeInteger(cents)) throw new Error('Price exceeds safe integer cents');
  return cents;
}

function dollars(cents: number): string {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export class SauceDemoPage {
  constructor(readonly page: Page) {}

  private productRow(name: string): Locator {
    return this.page.getByTestId('inventory-item').filter({
      has: this.page.getByTestId('inventory-item-name').and(this.page.getByText(name, { exact: true })),
    });
  }

  async login(username: string, password: string): Promise<void> {
    await this.page.goto('/');
    await this.page.getByPlaceholder('Username', { exact: true }).fill(username);
    await this.page.getByPlaceholder('Password', { exact: true }).fill(password);
    await this.page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(this.page).toHaveURL(/\/inventory\.html$/);
  }

  async addProduct(name: string): Promise<number> {
    const product = this.productRow(name);
    await expect(product, `Exactly one product named ${name}`).toHaveCount(1);
    const price = product.getByTestId('inventory-item-price');
    await expect(price).toHaveText(/^\$\d+\.\d{2}$/);
    const cents = priceInCents(await price.innerText());
    await product.getByRole('button', { name: 'Add to cart', exact: true }).click();
    await expect(product.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    return cents;
  }

  async expectCartCount(count: number): Promise<void> {
    await expect(this.page.getByTestId('shopping-cart-badge')).toHaveText(String(count));
  }

  async expectEmptyCart(): Promise<void> {
    await expect(this.page.getByTestId('shopping-cart-badge'), 'Fresh session has no cart items').toHaveCount(0);
  }

  async checkout(details: CheckoutDetails): Promise<void> {
    await this.page.getByTestId('shopping-cart-link').click();
    await expect(this.page).toHaveURL(/\/cart\.html$/);
    await this.page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await expect(this.page).toHaveURL(/\/checkout-step-one\.html$/);
    await this.page.getByPlaceholder('First Name', { exact: true }).fill(details.firstName);
    await this.page.getByPlaceholder('Last Name', { exact: true }).fill(details.lastName);
    await this.page.getByPlaceholder('Zip/Postal Code', { exact: true }).fill(details.postalCode);
    await this.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(this.page).toHaveURL(/\/checkout-step-two\.html$/);
  }

  async expectOrderItems(products: readonly PricedProduct[]): Promise<void> {
    await expect(this.page.getByTestId('inventory-item')).toHaveCount(products.length);
    for (const product of products) {
      const row = this.productRow(product.name);
      await expect(row, product.name).toHaveCount(1);
      await expect(row.getByTestId('item-quantity'), `${product.name} quantity`).toHaveText('1');
      await expect(row.getByTestId('inventory-item-price'), `${product.name} price`).toHaveText(dollars(product.price));
    }
  }

  async expectItemTotal(cents: number): Promise<void> {
    // Retry the observable total, without resubmitting checkout or a one-shot read.
    await expect(this.page.getByTestId('subtotal-label'), 'Item total equals the inventory price sum')
      .toHaveText(`Item total: ${dollars(cents)}`);
  }

  async finishCheckout(): Promise<void> {
    await this.page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(this.page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(this.page.getByRole('heading', { name: 'Thank you for your order!' })).toBeVisible();
  }
}
