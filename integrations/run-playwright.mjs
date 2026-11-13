import {spawn} from 'node:child_process';
import {copyFile,mkdir,mkdtemp,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import console from 'node:console';
import {createRequire} from 'node:module';
import process from 'node:process';
import {readPublishPolicy} from './testpilot-publish-policy.mjs';
import {blobDigest,runnerRoot,shardFiles,shardSettings} from './testpilot-shards.mjs';

const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const args = process.argv.slice(2);
const checkOnly = args[0] === '--testpilot-check';
if (checkOnly) args.shift();
const policy = readPublishPolicy();
const publishing = policy !== 'local-only' && process.env.TESTPILOT_LIST_MAPPINGS !== '1';
const releaseGate = process.env.TESTPILOT_RELEASE_GATE === '1';
const shardArgument = args.find(argument=>argument==='--shard'||argument.startsWith('--shard='));
const shard = shardArgument?.match(/^--shard=(\d+)\/(\d+)$/);

function run(arguments_, env) {
 return new Promise((resolve,reject) => {
  const child = spawn(process.execPath,[cli,...arguments_],{env,stdio:'inherit'});
  child.once('error',reject);
  child.once('exit',code=>resolve(code??1));
 });
}

const env = {...process.env};
delete env.TESTPILOT_PREFLIGHT;
delete env.TESTPILOT_PREFLIGHT_RESULT;
delete env.TESTPILOT_SKIP_PUBLISH;
delete env.TESTPILOT_PREFLIGHT_SUPPORTED;
if (releaseGate && !publishing && process.env.TESTPILOT_LIST_MAPPINGS!=='1' && !args.includes('--list')) {
 console.error('[Testpilot] Enable publishing before using the release gate.');
 process.exitCode = 1;
} else if (publishing && !checkOnly && shardArgument && !args.includes('--list')) {
 try {
  const index = Number(shard?.[1]), total = Number(shard?.[2]);
  if (!shard || index<1 || index>total || total<2 || total>128 || args.some(arg=>arg.startsWith('--reporter'))) {
   throw new Error('Use --shard=1/2 (with your shard number and total) and omit --reporter for Testpilot shard capture.');
  }
  const settings = shardSettings(env,runnerRoot());
  const {blob,manifest} = shardFiles(settings.folder,index,total);
  const folder = await mkdtemp(join(tmpdir(),'testpilot-shard-'));
  try {
   const temporary = join(folder,'report.zip');
   console.info(`[Testpilot] Capturing shard ${index}/${total} locally. The merge job publishes the combined run.`);
   process.exitCode = await run([...args,'--reporter=blob,list','--output='+join(folder,'results')],{...env,
    TESTPILOT_SKIP_PUBLISH:'1',PLAYWRIGHT_BLOB_OUTPUT_FILE:temporary});
   if (process.exitCode > 1) throw new Error(`Shard ${index}/${total} did not finish.`);
   const digest = await blobDigest(temporary);
   await mkdir(settings.folder,{recursive:true});
   await copyFile(temporary,blob+'.tmp');
   await rename(blob+'.tmp',blob);
   await writeFile(manifest+'.tmp',JSON.stringify({identity:settings.identity,index,total,digest,exitCode:process.exitCode}));
   await rename(manifest+'.tmp',manifest);
  } finally {await rm(folder,{recursive:true,force:true})}
 } catch(error) {
  console.error('[Testpilot] '+error.message);
  process.exitCode = 1;
 }
} else if (checkOnly && !publishing) {
 console.error('[Testpilot] Enable publishing before running the connection check.');
 process.exitCode = 1;
} else if (publishing && args.some(arg=>arg==='--reporter'||arg.startsWith('--reporter='))) {
 console.error('[Testpilot] Remove --reporter to publish, or set TESTPILOT_PUBLISH=0 for a local-only run.');
 process.exitCode = 1;
} else if (publishing && (checkOnly || !args.some(arg=>['--list','--help','-h'].includes(arg)))) {
 const discoveryArgs = args.includes('--list') ? args : [...args,'--list'];
 const folder = await mkdtemp(join(tmpdir(), 'testpilot-preflight-'));
 try {
  const resultFile = join(folder, 'result');
  console.info(`[Testpilot] Publishing mode: ${policy}.`);
  process.exitCode = await run(discoveryArgs,{...env,TESTPILOT_PREFLIGHT:'1',TESTPILOT_PREFLIGHT_RESULT:resultFile,
   TESTPILOT_RESUME_PENDING:checkOnly?'0':'1'});
  const result = await readFile(resultFile,'utf8').catch(()=>null);
  if (!checkOnly && process.exitCode === 0) process.exitCode = await run(args,{...env,TESTPILOT_PREFLIGHT_SUPPORTED:result==='supported'?'1':'0'});
  else if (!checkOnly && policy === 'best-effort' && !releaseGate) {
   if (result === 'transient') {
    console.warn('[Testpilot] Connection check unavailable. Tests will run and completed results can be retried if upload fails.');
    process.exitCode = await run(args,env);
   } else if (result === 'invalid') {
    console.warn('[Testpilot] Publishing disabled for this run. Correct the setup before running again.');
    process.exitCode = await run(args,{...env,TESTPILOT_SKIP_PUBLISH:'1'});
   }
  }
 } finally {await rm(folder,{recursive:true,force:true})}
} else {
 if (policy === 'local-only' && !args.some(arg=>['--list','--help','-h'].includes(arg))) console.info('[Testpilot] Local-only mode. Results stay in Playwright.');
 process.exitCode = await run(args,env);
}
