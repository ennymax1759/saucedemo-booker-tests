import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveTestpilotTarget } from '../integrations/testpilot-targets.mjs';

const sauceDemoTarget = {
  baseURL: 'https://testpilot.example.test',
  projectId: '6594c323-0c52-4742-8b32-f2cfb3c705a1',
  runId: '9d14ed55-f54b-4206-8f44-9bd98514643b',
  environment: 'Public demo sites',
};

void test('resolves named targets and scopes the ignored credential to the original destination', () => {
  const root = mkdtempSync(join(tmpdir(), 'testpilot-targets-'));
  try {
    assert.equal(resolveTestpilotTarget(root, {}, sauceDemoTarget).usesLocalKey, true);
    assert.throws(() => resolveTestpilotTarget(root, { TESTPILOT_TARGET: 'staging' }), /Add testpilot.targets.json/);

    const staging = { ...sauceDemoTarget, baseURL: 'http://127.0.0.1:5176', environment: 'Staging' };
    const anotherProject = { ...sauceDemoTarget, projectId: 'c50adc86-971f-4c09-b484-40d07164eacf' };
    writeFileSync(join(root, 'testpilot.targets.json'), JSON.stringify({
      defaultTarget: 'staging', targets: { staging, release: sauceDemoTarget, 'another-project': anotherProject },
    }));

    assert.deepEqual(resolveTestpilotTarget(root, {}, sauceDemoTarget), { ...staging, name: 'staging', usesLocalKey: false });
    assert.deepEqual(resolveTestpilotTarget(root, { TESTPILOT_TARGET: 'release', TESTPILOT_ENVIRONMENT: 'Release' }, sauceDemoTarget), {
      ...sauceDemoTarget, environment: 'Release', name: 'release', usesLocalKey: true,
    });
    assert.equal(resolveTestpilotTarget(root, { TESTPILOT_TARGET: 'another-project' }, sauceDemoTarget).usesLocalKey, false);
    assert.equal(resolveTestpilotTarget(root, { TESTPILOT_TARGET: 'release', TESTPILOT_RUN_ID: '93735db0-0529-4860-8d27-68e63cad08ce' }, sauceDemoTarget).usesLocalKey, false);
    assert.throws(() => resolveTestpilotTarget(root, { TESTPILOT_TARGET: 'missing' }, sauceDemoTarget), /Choose a named target/);
    assert.throws(() => resolveTestpilotTarget(root, { TESTPILOT_URL: 'http://qa.example.test' }, sauceDemoTarget), /Use an HTTPS Testpilot URL/);
    assert.throws(() => resolveTestpilotTarget(root, { TESTPILOT_URL: 'https://user@example.test' }, sauceDemoTarget), /without credentials/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
