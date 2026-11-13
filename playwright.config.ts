import { defineConfig, devices, type ReporterDescription } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { readPublishPolicy } from './integrations/testpilot-publish-policy.mjs';
import { loadLocalTestpilotTarget, resolveTestpilotTarget } from './integrations/testpilot-targets.mjs';
import './support/env';

const listMappings = process.env.TESTPILOT_LIST_MAPPINGS === '1';
const preflight = process.env.TESTPILOT_PREFLIGHT === '1';
const listTests = process.argv.includes('--list');
const publishToTestpilot = readPublishPolicy(process.env) !== 'local-only'
  && process.env.TESTPILOT_SKIP_PUBLISH !== '1' && !listMappings && (!listTests || preflight);
const target = publishToTestpilot ? resolveTestpilotTarget(__dirname, process.env, loadLocalTestpilotTarget(__dirname)) : undefined;
const localCredentials = resolve(__dirname, '.env.testpilot');

if (publishToTestpilot && !process.env.CI && !process.env.TESTPILOT_API_KEY?.trim()
    && target?.usesLocalKey && existsSync(localCredentials)) {
  const key = parseEnv(readFileSync(localCredentials, 'utf8')).TESTPILOT_API_KEY?.trim();
  if (key) process.env.TESTPILOT_API_KEY = key;
}

export const testpilotReporter: ReporterDescription = [
  './integrations/testpilot-playwright-reporter.mjs',
  {
    baseURL: target?.baseURL,
    projectId: target?.projectId,
    runId: target?.runId,
    environment: target?.environment,
    mapFile: process.env.TESTPILOT_MAP_FILE || './testpilot-map.json',
  },
];

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: true,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: preflight ? [testpilotReporter] : [
    ['list'],
    ...(publishToTestpilot || listMappings ? [testpilotReporter] : []),
    ['html', { open: 'never' }],
    ['json', { outputFile: 'artifacts/results.json' }],
  ],
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    testIdAttribute: 'data-test',
    // Do not capture login/API authentication data in traces.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'ui-chromium',
      testMatch: 'ui/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'https://www.saucedemo.com' },
    },
    {
      name: 'api',
      testMatch: 'api/**/*.spec.ts',
      use: {
        baseURL: 'https://restful-booker.herokuapp.com',
        extraHTTPHeaders: { Accept: 'application/json' },
      },
    },
  ],
});
