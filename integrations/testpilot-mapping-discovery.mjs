import {writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import process from 'node:process';
import {mappingKey} from './testpilot-playwright-reporter.mjs';

export default class MappingDiscovery {
 onBegin(config,suite) {
  const root = config.configFile ? dirname(config.configFile) : config.rootDir;
  const tests = suite.allTests().map(test=>({
   reference:mappingKey(test,root),
   project:test.parent.project()?.name || '',
   caseIds:test.annotations.filter(annotation=>annotation.type==='testpilot')
    .map(annotation=>annotation.description ?? ''),
  }));
  writeFileSync(process.env.TESTPILOT_MAPPING_DISCOVERY,JSON.stringify({root,tests}));
 }
}
