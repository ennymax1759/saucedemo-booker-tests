import console from 'node:console';
import {readdir, readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {retryDelivery} from './testpilot-playwright-reporter.mjs';
import {loadLocalTestpilotTarget,resolveTestpilotTarget} from './testpilot-targets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
try {
 const target = resolveTestpilotTarget(root,process.env,loadLocalTestpilotTarget(root));
 const directory = resolve(root,'artifacts','testpilot-pending');
 const [requested,...extra] = process.argv.slice(2);
 if (extra.length) throw new Error('Specify at most one delivery ID.');
 const files = requested ? [] : await readdir(directory).catch(error=>{
  if (error.code==='ENOENT') return [];
  throw error;
 });
 const ids = files.filter(file=>/^[0-9a-f-]{36}\.json$/i.test(file)).map(file=>file.slice(0,-5)).sort();
 const deliveryId = requested || (ids.length===1 ? ids[0] : undefined);
 if (!deliveryId && !ids.length) {
  console.info('[Testpilot] No pending uploads.');
 } else if (!deliveryId) {
  console.info('[Testpilot] Pending uploads. Run npm run testpilot:retry -- <delivery ID>.');
  for (const id of ids) console.info(id);
 } else {
  let token = process.env.TESTPILOT_API_KEY?.trim();
  if (!token && !process.env.CI && target.usesLocalKey) {
   const source = await readFile(resolve(root,'.env.testpilot'),'utf8').catch(error=>{
    if (error.code==='ENOENT') return '';
    throw error;
   });
   token = parseEnv(source).TESTPILOT_API_KEY?.trim();
  }
  if (!token) throw new Error('Set TESTPILOT_API_KEY before retrying the upload.');
  await retryDelivery(root,deliveryId,{...target,origin:target.baseURL},token);
 }
} catch (error) {
 console.error('[Testpilot] '+(error.code==='ENOENT' ? 'Pending upload not found.' : error.message));
 process.exitCode = 1;
}
