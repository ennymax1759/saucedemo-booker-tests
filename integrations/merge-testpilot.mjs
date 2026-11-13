import {spawn} from 'node:child_process';
import console from 'node:console';
import {copyFile,mkdtemp,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import process from 'node:process';
import {readPublishPolicy} from './testpilot-publish-policy.mjs';
import {readShards,runnerRoot,shardDeliveryId,shardSettings} from './testpilot-shards.mjs';

const root = runnerRoot();
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');

function merge(folder,env) {
 return new Promise((accept,reject) => {
  const child = spawn(process.execPath,[cli,'merge-reports','--config',resolve(root,'playwright.testpilot-merge.config.ts'),folder],{env,stdio:'inherit'});
  child.once('error',reject);
  child.once('exit',code=>accept(code??1));
 });
}

try {
 const [count,mode,...other] = process.argv.slice(2);
 if (!/^\d{1,3}$/.test(count??'') || Number(count)<2 || Number(count)>128 || (mode && mode!=='--local-only') || other.length) {
  throw new Error('Run npm run testpilot:merge -- <shard count from 2 to 128> [--local-only].');
 }
 const policy = mode==='--local-only'?'local-only':readPublishPolicy();
 const settings = shardSettings(process.env,root);
 const shards = await readShards(settings,Number(count));
 const folder = await mkdtemp(join(tmpdir(),'testpilot-merge-'));
 try {
  await Promise.all(shards.map(({blob},index)=>copyFile(blob,join(folder,`shard-${index+1}.zip`))));
  const marker = join(folder,'reporter-status');
  const deliveryId = shardDeliveryId(settings.identity);
  const env = {...process.env,TESTPILOT_MERGED_DELIVERY_ID:deliveryId,TESTPILOT_BUILD:settings.build,
   TESTPILOT_REPORTER_ROOT:root,TESTPILOT_PREFLIGHT_RESULT:marker};
  delete env.TESTPILOT_SKIP_PUBLISH;
  delete env.TESTPILOT_PREFLIGHT_SUPPORTED;
  if (policy==='local-only') {
   console.info('[Testpilot] Validated every shard. Building the local Playwright report.');
   process.exitCode=await merge(folder,{...env,TESTPILOT_PREFLIGHT:'0',TESTPILOT_PUBLISH:'local-only'});
  } else {
   const preflight = await merge(folder,{...env,TESTPILOT_PREFLIGHT:'1',TESTPILOT_RESUME_PENDING:'1'});
   const readiness = await readFile(marker,'utf8').catch(()=>null);
   if (preflight || !['supported','legacy'].includes(readiness)) throw new Error('Merged results did not pass the Testpilot connection check.');
   const replay = {...env,TESTPILOT_PREFLIGHT:'0',TESTPILOT_PREFLIGHT_SUPPORTED:readiness==='supported'?'1':'0',
    TESTPILOT_MERGE_RESULT:marker};
   process.exitCode = await merge(folder,replay);
   const result = await readFile(marker,'utf8');
   if (!['published','partial','failed','interrupted','gate_failed'].includes(result)) throw new Error('The merged reporter did not confirm its outcome.');
   if (['interrupted','gate_failed'].includes(result) || ((policy==='required' || env.TESTPILOT_RELEASE_GATE==='1') && result!=='published')) process.exitCode = 1;
  }
  if (shards.some(shard=>shard.exitCode!==0)) process.exitCode=1;
 } finally {await rm(folder,{recursive:true,force:true})}
} catch(error) {
 console.error('[Testpilot] '+error.message);
 process.exitCode = 1;
}
