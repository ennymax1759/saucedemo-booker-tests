import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {URL} from 'node:url';

const targetName=/^[a-z0-9][a-z0-9-]{0,47}$/;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const filename='testpilot.targets.json';

function record(value) {
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}

export function loadLocalTestpilotTarget(root) {
 const file=resolve(root,'testpilot.local-target.json');
 const fallback={baseURL:'https://testpilot.ng'};
 if (!existsSync(file)) return fallback;
 let target;
 try {
  target=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 } catch (error) {
  throw new Error('Could not read testpilot.local-target.json.',{cause:error});
 }
 if (!record(target)||typeof target.baseURL!=='string'||!uuid.test(target.projectId??'')
     ||!uuid.test(target.runId??'')||typeof target.environment!=='string'||!target.environment.trim()) {
  throw new Error('Set the Testpilot server origin, project ID, run ID, and environment in testpilot.local-target.json.');
 }
 return target;
}

export function resolveTestpilotTarget(root,env,defaults={}) {
 const file=resolve(root,filename);
 let target=defaults;
 let name=env.TESTPILOT_TARGET?.trim()||'';
 if (existsSync(file)) {
  let config;
  try {
   config=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  } catch (error) {
   throw new Error(`Could not read ${filename}. Check that it contains valid JSON.`,{cause:error});
  }
  if (!record(config)||!record(config.targets)||typeof config.defaultTarget!=='string'
      ||!targetName.test(config.defaultTarget)||!Object.hasOwn(config.targets,config.defaultTarget)) {
   throw new Error(`Set defaultTarget and targets in ${filename}.`);
  }
  name ||= config.defaultTarget;
  if (!targetName.test(name)||!Object.hasOwn(config.targets,name)) {
   throw new Error(`Choose a named target listed in ${filename}.`);
  }
  target=config.targets[name];
  if (!record(target)||typeof target.baseURL!=='string'||typeof target.projectId!=='string'||!uuid.test(target.projectId)
      ||typeof target.runId!=='string'||!uuid.test(target.runId)||typeof target.environment!=='string'||!target.environment.trim()
      ||target.environment.length>160) {
   throw new Error(`Target "${name}" requires a server URL, full project and run IDs, and an environment.`);
  }
 } else if (name) {
  throw new Error(`Add ${filename} before selecting a named Testpilot target.`);
 }
 const baseURL=env.TESTPILOT_URL?.trim()||target.baseURL||'https://testpilot.ng';
 const url=new URL(baseURL);
 const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if (url.username||url.password||(url.protocol!=='https:'&&!(loopback&&url.protocol==='http:'))) {
  throw new Error('Use an HTTPS Testpilot URL without credentials, or HTTP on loopback.');
 }
 const projectId=env.TESTPILOT_PROJECT_ID?.trim()||target.projectId||'';
 const runId=env.TESTPILOT_RUN_ID?.trim()||target.runId||'';
 const usesLocalKey=!!defaults.projectId&&!!defaults.runId&&url.origin===defaults.baseURL
  &&projectId===defaults.projectId&&runId===defaults.runId;
 const environment=env.TESTPILOT_ENVIRONMENT?.trim()||(target!==defaults||usesLocalKey?target.environment:undefined);
 return {baseURL:url.origin,projectId,runId,environment,name,usesLocalKey};
}
