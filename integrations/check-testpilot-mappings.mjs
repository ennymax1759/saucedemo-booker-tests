import {spawnSync} from 'node:child_process';
import console from 'node:console';
import {mkdtempSync,readFileSync,rmSync,rmdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath,URL} from 'node:url';
import {parseArgs} from 'node:util';
import {normalizeCaseReference} from './testpilot-playwright-reporter.mjs';

const options = {
 'config':{type:'string'},
 'map':{type:'string'},
 'project':{type:'string'},
 'json':{type:'boolean'},
 'help':{type:'boolean',short:'h'},
};
const messages = {
 obsolete:'Remove these entries or update their references after a rename or move.',
 unmapped:'Map these tests in Automation → Mappings or add a testpilot annotation.',
 invalid:'Use a full case UUID or the TC-XXXXXXXX case code.',
 conflict:'Use one case reference per test and make the mapping file and annotation agree.',
 duplicate:'Map each test to a distinct case, or validate each browser target separately with --project.',
};

function discover(config) {
 const folder = mkdtempSync(join(tmpdir(),'testpilot-mapping-check-'));
 const output = join(folder,'discovered.json');
 try {
  const reporter = fileURLToPath(new URL('./testpilot-mapping-discovery.mjs',import.meta.url));
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const env = {...process.env,TESTPILOT_PUBLISH:'local-only',TESTPILOT_MAPPING_DISCOVERY:output};
  delete env.TESTPILOT_API_KEY;
  delete env.TESTPILOT_LIST_MAPPINGS;
  delete env.TESTPILOT_PREFLIGHT;
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  const args = [cli,'test','--list','--forbid-only','--reporter',reporter];
  if (config) args.push('--config',config);
  const child = spawnSync(process.execPath,args,{env,stdio:'ignore',timeout:60000,windowsHide:true});
  if (child.status!==0) throw new Error('Playwright could not list the full suite. Run npm run test:list to diagnose discovery.');
  const data = JSON.parse(readFileSync(output,'utf8'));
  if (!data.tests.length) throw new Error('Playwright discovered no tests. Check the selected config.');
  return data;
 } finally {
  rmSync(output,{force:true});
  rmdirSync(folder);
 }
}

function readMappings(path, optional) {
 let text;
 try {text = readFileSync(path,'utf8')} catch (error) {
  if (error.code==='ENOENT' && optional) return {};
  throw new Error('Could not read the Testpilot mapping file. Check the path.',{cause:error});
 }
 let mappings;
 try {mappings = JSON.parse(text)} catch (error) {throw new Error('The Testpilot mapping file must contain valid JSON.',{cause:error})}
 if (!mappings || typeof mappings!=='object' || Array.isArray(mappings)) throw new Error('Use a JSON object keyed by file::test reference.');
 return mappings;
}

function testLabel(test) {
 return test.project ? `${test.reference} (${test.project})` : test.reference;
}

function analyze(tests,mappings,project) {
 const references = new Set(tests.map(test=>test.reference));
 const selected = project ? tests.filter(test=>test.project===project) : tests;
 if (!selected.length) throw new Error('No tests were discovered for the requested project.');
 const issues = {obsolete:[],unmapped:[],invalid:[],conflict:[],duplicate:[]};
 const invalidFile = new Set();
 for (const [ref,caseId] of Object.entries(mappings)) {
  if (!references.has(ref)) issues.obsolete.push(ref);
  if (typeof caseId!=='string' || !normalizeCaseReference(caseId) || caseId.trim()!==caseId) {
   issues.invalid.push(ref);
   invalidFile.add(ref);
  }
 }
 const cases = new Map();
 for (const test of selected) {
  const label = testLabel(test);
  const annotationIds = test.caseIds.map(normalizeCaseReference);
  if (annotationIds.includes(null)) issues.invalid.push(label);
  if (invalidFile.has(test.reference) || annotationIds.includes(null)) continue;
  const ids = new Set(annotationIds);
  if (Object.hasOwn(mappings,test.reference)) ids.add(normalizeCaseReference(mappings[test.reference]));
  if (ids.size===0) issues.unmapped.push(label);
  if (ids.size>1) issues.conflict.push(label);
  if (ids.size!==1) continue;
  const [caseId] = ids;
  const owners = cases.get(caseId) ?? [];
  owners.push(label);
  cases.set(caseId,owners);
 }
 const shortAliases = new Map();
 for (const [id,owners] of cases) {
  if (id.startsWith('tc-')) continue;
  if (owners.length>1) issues.duplicate.push({caseId:id,tests:owners});
  const shortCode = `tc-${id.slice(0,8)}`;
  if (cases.has(shortCode)) {
   const aliases = shortAliases.get(shortCode) ?? [...cases.get(shortCode)];
   aliases.push(...owners);
   shortAliases.set(shortCode,aliases);
  }
 }
 for (const [caseId,owners] of cases) {
  if (!caseId.startsWith('tc-')) continue;
  const aliases = shortAliases.get(caseId) ?? owners;
  if (aliases.length>1) issues.duplicate.push({caseId,tests:aliases});
 }
 return {discovered:tests.length,checked:selected.length,mapped:[...cases.values()].reduce((sum,owners)=>sum+owners.length,0),issues};
}

function printable(value) {
 return JSON.stringify(value).slice(1,-1).replaceAll('\\u001b','[escape]');
}

function print(result) {
 console.info(`[Testpilot] ${result.checked} tests checked · ${result.mapped} mapped · ${result.discovered} discovered.`);
 for (const [kind,items] of Object.entries(result.issues)) {
  if (!items.length) continue;
  console.info(`${kind} (${items.length}) · ${messages[kind]}`);
  for (const item of items.slice(0,20)) {
   if (typeof item==='string') console.info(`  ${printable(item)}`);
   else console.info(`  ${item.caseId} → ${item.tests.map(printable).join(', ')}`);
  }
  if (items.length>20) console.info('  Use --json for the full list.');
 }
}

try {
 const {values} = parseArgs({options});
 if (values.help) {
  console.info('Usage: npm run testpilot:mappings -- [--config <file>] [--map <file>] [--project <name>] [--json]');
 } else {
  const {root,tests} = discover(values.config);
  const specifiedPath = values.map || process.env.TESTPILOT_MAP_FILE?.trim();
  const path = resolve(root,specifiedPath || 'testpilot-map.json');
  const result = analyze(tests,readMappings(path,!specifiedPath),values.project);
  if (values.json) console.info(JSON.stringify(result,null,2));
  else print(result);
  if (Object.values(result.issues).some(items=>items.length)) process.exitCode = 1;
 }
} catch (error) {
 const message = error.code==='ERR_PARSE_ARGS_UNKNOWN_OPTION' || error.code==='ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL'
  ? 'Use the full suite for mapping drift detection. Run with --help for supported options.' : error.message;
 console.error('[Testpilot] '+message);
 process.exitCode = 2;
}
