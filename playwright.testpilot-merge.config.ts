import { defineConfig } from '@playwright/test';
import config, {testpilotReporter} from './playwright.config';

const preflight = process.env.TESTPILOT_PREFLIGHT === '1';
const localOnly = process.env.TESTPILOT_PUBLISH === 'local-only' || process.env.TESTPILOT_PUBLISH === '0';

export default defineConfig({
  ...config,
  reporter: preflight ? [testpilotReporter] : [
    ...(localOnly ? [] : [testpilotReporter]),
    ['html', {open:'never'}],
    ['json', {outputFile:'artifacts/results.json'}],
  ],
});
