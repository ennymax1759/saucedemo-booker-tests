import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';

export default tseslint.config(
  { ignores: ['node_modules/**', 'artifacts/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['integrations/testpilot-playwright-reporter.mjs'],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        clearInterval: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setInterval: 'readonly',
      },
    },
    // The reporter strips terminal escapes and control characters from output.
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    ...playwright.configs['flat/recommended'],
    files: ['tests/**/*.ts', 'pages/**/*.ts', 'fixtures/**/*.ts'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'error',
      'playwright/missing-playwright-await': 'error',
    },
  },
  {
    files: ['tests/ui/checkout.spec.ts'],
    rules: {
      'playwright/expect-expect': ['error', {
        assertFunctionNames: ['expectOrderItems', 'expectItemTotal', 'expectCartCount'],
      }],
    },
  },
);
