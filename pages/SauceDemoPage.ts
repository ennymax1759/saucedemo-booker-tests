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

/**
 * Page Object Model representing the SauceDemo store application.
 * Organizes locators and interactions across Login, Inventory, Cart, and Checkout flows.
 */
export class SauceDemoPage {
  // --- Locators: Authentication ---
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;

  // --- Locators: Header & Navigation ---
  readonly cartLink: Locator;
  readonly cartBadge: Locator;

  // --- Locators: Inventory / Catalog ---
  readonly inventoryItems: Locator;

  // --- Locators: Checkout - Step One (Information) ---
  readonly checkoutButton: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly postalCodeInput: Locator;
  readonly continueButton: Locator;

  // --- Locators: Checkout - Step Two (Overview) ---
  readonly subtotalLabel: Locator;
  readonly finishButton: Locator;

  // --- Locators: Checkout - Complete ---
  readonly completeHeading: Locator;

  constructor(readonly page: Page) {
    // Authentication
    this.usernameInput = page.getByPlaceholder('Username', { exact: true });
    this.passwordInput = page.getByPlaceholder('Password', { exact: true });
    this.loginButton = page.getByRole('button', { name: 'Login', exact: true });

    // Header & Navigation
    this.cartLink = page.getByTestId('shopping-cart-link');
    this.cartBadge = page.getByTestId('shopping-cart-badge');

    // Inventory
    this.inventoryItems = page.getByTestId('inventory-item');

    // Checkout Step One
    this.checkoutButton = page.getByRole('button', { name: 'Checkout', exact: true });
    this.firstNameInput = page.getByPlaceholder('First Name', { exact: true });
    this.lastNameInput = page.getByPlaceholder('Last Name', { exact: true });
    this.postalCodeInput = page.getByPlaceholder('Zip/Postal Code', { exact: true });
    this.continueButton = page.getByRole('button', { name: 'Continue', exact: true });

    // Checkout Step Two
    this.subtotalLabel = page.getByTestId('subtotal-label');
    this.finishButton = page.getByRole('button', { name: 'Finish', exact: true });

    // Checkout Complete
    this.completeHeading = page.getByRole('heading', { name: 'Thank you for your order!' });
  }

  /**
   * Returns a scoped Locator for an inventory item row identified by its product name.
   */
  productRow(name: string): Locator {
    return this.inventoryItems.filter({
      has: this.page.getByTestId('inventory-item-name').and(this.page.getByText(name, { exact: true })),
    });
  }

  /**
   * Navigates to the base URL and authenticates with the provided credentials.
   */
  async login(username: string, password: string): Promise<void> {
    await this.page.goto('/');
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
    await expect(this.page).toHaveURL(/\/inventory\.html$/);
  }

  /**
   * Adds a product to the cart by name and returns its price in integer cents.
   */
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

  /**
   * Asserts the displayed item count badge in the shopping cart header.
   */
  async expectCartCount(count: number): Promise<void> {
    await expect(this.cartBadge).toHaveText(String(count));
  }

  /**
   * Asserts that the shopping cart badge is absent (i.e. cart is empty).
   */
  async expectEmptyCart(): Promise<void> {
    await expect(this.cartBadge, 'Fresh session has no cart items').toHaveCount(0);
  }

  /**
   * Navigates from inventory to the cart, initiates checkout, enters customer details, and proceeds to the overview.
   */
  async checkout(details: CheckoutDetails): Promise<void> {
    await this.cartLink.click();
    await expect(this.page).toHaveURL(/\/cart\.html$/);
    await this.checkoutButton.click();
    await expect(this.page).toHaveURL(/\/checkout-step-one\.html$/);
    await this.firstNameInput.fill(details.firstName);
    await this.lastNameInput.fill(details.lastName);
    await this.postalCodeInput.fill(details.postalCode);
    await this.continueButton.click();
    await expect(this.page).toHaveURL(/\/checkout-step-two\.html$/);
  }

  /**
   * Asserts that the checkout overview rows match the expected products, quantities, and prices.
   */
  async expectOrderItems(products: readonly PricedProduct[]): Promise<void> {
    await expect(this.inventoryItems).toHaveCount(products.length);
    for (const product of products) {
      const row = this.productRow(product.name);
      await expect(row, product.name).toHaveCount(1);
      await expect(row.getByTestId('item-quantity'), `${product.name} quantity`).toHaveText('1');
      await expect(row.getByTestId('inventory-item-price'), `${product.name} price`).toHaveText(dollars(product.price));
    }
  }

  /**
   * Asserts the computed item subtotal against the sum of individual product prices in cents.
   */
  async expectItemTotal(cents: number): Promise<void> {
    await expect(this.subtotalLabel, 'Item total equals the inventory price sum')
      .toHaveText(`Item total: ${dollars(cents)}`);
  }

  /**
   * Confirms the checkout order and verifies the final completion page.
   */
  async finishCheckout(): Promise<void> {
    await this.finishButton.click();
    await expect(this.page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(this.completeHeading).toBeVisible();
  }
}
