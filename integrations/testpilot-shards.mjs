import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import process from 'node:process';
import {loadLocalTestpilotTarget,resolveTestpilotTarget} from './testpilot-targets.mjs';

export function shardSettings(env, root) {
 const build = env.TESTPILOT_BUILD?.trim() || (env.GITHUB_RUN_ID && env.GITHUB_RUN_ATTEMPT && `${env.GITHUB_RUN_ID}/${env.GITHUB_RUN_ATTEMPT}`);
 if (!env.TESTPILOT_SHARD_DIR?.trim() || !build || build.length > 200) {
  throw new Error('Set TESTPILOT_SHARD_DIR and a unique TESTPILOT_BUILD for this pipeline attempt.');
 }
 const target = resolveTestpilotTarget(root,env,loadLocalTestpilotTarget(root));
 const targetIdentity = JSON.stringify([build,target.baseURL,target.projectId,target.runId,target.environment ?? 'CI']);
 return {folder:resolve(root,env.TESTPILOT_SHARD_DIR),build,identity:createHash('sha256').update(targetIdentity).digest('hex')};
}

export function shardFiles(folder,index,total) {
 const stem = resolve(folder,`shard-${index}-of-${total}`);
 return {blob:stem+'.zip',manifest:stem+'.json'};
}

export async function blobDigest(path) {
 const hash = createHash('sha256');
 for await (const chunk of createReadStream(path)) hash.update(chunk);
 return hash.digest('hex');
}

export async function readShards(settings,total) {
 const files = await readdir(settings.folder).catch(error => {
  if (error.code==='ENOENT') return [];
  throw error;
 });
 const missing = [];
 const shards = [];
 for (let index=1;index<=total;index++) {
  const {blob,manifest} = shardFiles(settings.folder,index,total);
  if (!files.includes(`shard-${index}-of-${total}.json`) || !files.includes(`shard-${index}-of-${total}.zip`)) {
   missing.push(index);
   continue;
  }
  const data = JSON.parse(await readFile(manifest,'utf8'));
  if (data.identity!==settings.identity || data.index!==index || data.total!==total || ![0,1].includes(data.exitCode)) {
   throw new Error(`Shard ${index}/${total} belongs to another pipeline, target, or incomplete test run.`);
  }
  if (data.digest!==await blobDigest(blob)) throw new Error(`Shard ${index}/${total} did not pass its checksum.`);
  shards.push({blob,exitCode:data.exitCode});
 }
 if (missing.length) throw new Error(`Missing shards: ${missing.join(', ')} of ${total}. No results were sent.`);
 return shards;
}

export function shardDeliveryId(identity) {
 const hash = createHash('sha256').update(identity).digest('hex');
 return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

export const runnerRoot = () => resolve(process.cwd());
