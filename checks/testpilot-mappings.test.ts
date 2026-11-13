import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

void test('discovers every project and diagnoses stale, missing, conflicting and duplicate mappings', () => {
  const artifacts = resolve('artifacts');
  mkdirSync(artifacts, { recursive: true });
  const root = mkdtempSync(join(artifacts, 'mapping-check-'));
  assert.equal(resolve(root,'..'),artifacts);
  try {
    const fixture = join(root,'playwright.config.mjs');
    const map = join(root,'mapping.json');
    const a = 'tests/checkout.spec.mjs::Checkout > validates totals';
    const b = 'tests/checkout.spec.mjs::Checkout > checks delivery';
    const c = 'tests/booking.spec.mjs::creates booking';
    const stale = 'tests/old.spec.mjs::moved test';
    const id = '01234567-0123-4123-8123-0123456789ab';
    const annotated = 'TC-AABBCCDD';
    mkdirSync(join(root,'tests'));
    writeFileSync(fixture, `export default {testDir:'./tests',projects:[
      {name:'checkout',testMatch:'**/checkout.spec.mjs'},{name:'booking',testMatch:'**/booking.spec.mjs'}
    ]};`);
    writeFileSync(join(root,'tests','checkout.spec.mjs'), `import {test} from '@playwright/test';
      test.describe('Checkout',()=>{
        test('validates totals',{annotation:{type:'testpilot',description:'${annotated}'}},()=>{throw Error('Discovery must never run a test')});
        test('checks delivery',()=>{throw Error('Discovery must never run a test')});
      });`);
    writeFileSync(join(root,'tests','booking.spec.mjs'), `import {test} from '@playwright/test';
      test('creates booking',()=>{throw Error('Discovery must never run a test')});`);
    const run = (expected: number, args: string[] = []) => {
      const result = spawnSync(process.execPath, [resolve('integrations/check-testpilot-mappings.mjs'),'--config',fixture,'--map',map,'--json',...args], {
        env:{...process.env,TESTPILOT_API_KEY:'must-not-be-required-or-printed'}, encoding:'utf8', windowsHide:true,
      });
      assert.equal(result.status,expected,result.stderr || result.stdout);
      assert.doesNotMatch(result.stderr+result.stdout,/must-not-be-required-or-printed/);
      return result;
    };
    writeFileSync(map,JSON.stringify({[a]:annotated,[b]:id,[c]:'TC-99887766'}));
    assert.deepEqual(JSON.parse(run(0).stdout),{discovered:3,checked:3,mapped:3,issues:{obsolete:[],unmapped:[],invalid:[],conflict:[],duplicate:[]}});
    assert.equal(JSON.parse(run(0,['--project','checkout']).stdout).checked,2);
    writeFileSync(map,JSON.stringify({[a]:'TC-FFEEDDCC',[b]:id,[c]:'TC-01234567',[stale]:'TC-55667788'}));
    assert.deepEqual(JSON.parse(run(1).stdout).issues,{
      obsolete:[stale],unmapped:[],invalid:[],conflict:[a+' (checkout)'],
      duplicate:[{caseId:'tc-01234567',tests:[c+' (booking)',b+' (checkout)']}],
    });
    writeFileSync(map,JSON.stringify({[c]:'not-a-case'}));
    assert.deepEqual(JSON.parse(run(1).stdout).issues,{
      obsolete:[],unmapped:[b+' (checkout)'],invalid:[c],conflict:[],duplicate:[],
    });
    assert.match(run(2,['--grep','totals']).stderr,/full suite/);
    writeFileSync(map,'{oops');
    assert.match(run(2).stderr,/valid JSON/);
  } finally {
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
});
