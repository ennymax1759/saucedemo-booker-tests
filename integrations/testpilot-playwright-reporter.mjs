import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {appendFile,mkdir,open,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {dirname, relative, resolve, sep} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const reporterVersion = '2.1.0';
const caseCode = /^TC-[0-9a-f]{8}$/i;
const retryable = new Set([429, 500, 502, 503, 504]);
const accepted = new Set(['published', 'replayed']);
const artifactLimit=10*1024*1024;
const artifactExtensions={
 'image/png':'png','image/jpeg':'jpg','image/webp':'webp',
 'video/webm':'webm','video/mp4':'mp4',
};

const rejectionHint = {
 run_inactive:'the run has been completed; select an active target',
 not_in_run:'add the mapped case to the target run and Automation module',
 ambiguous:'use the full case UUID',
 manual_result:'the saved manual result is protected; use a separate automation run',
 environment_mismatch:'select a target run for this environment',
 configuration_mismatch:'select a target run for this browser configuration',
 superseded:'a newer result is already saved',
 conflict:'this delivery already has a different result for the case',
 protected:'result protected; check the target run and saved result',
 target_changed:'the target changed; refresh the run and check the mapping',
};

export function mappingKey(test, root) {
 const file = relative(root, test.location.file).split(sep).join('/');
 return file + '::' + test.titlePath().slice(3).join(' > ');
}

export function normalizeCaseReference(value) {
 const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
 return uuid.test(candidate) || caseCode.test(candidate) ? candidate : null;
}

async function loadMappings(root, filename) {
 if (!filename) return {};
 let mappings;
 try {
  mappings = JSON.parse(await readFile(resolve(root, filename), 'utf8'));
 } catch {
  throw new Error('Could not read the Testpilot mapping file. Check its path and JSON syntax.');
 }
 if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings) ||
  !Object.values(mappings).every(value => typeof value === 'string' && (uuid.test(value) || caseCode.test(value)))) {
  throw new Error('The Testpilot mapping file must map Playwright test names to valid Testpilot case IDs.');
 }
 return mappings;
}

function endpoint(base, project, run) {
 const url = new URL(base);
 const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
 if (url.username || url.password || url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
  throw new Error('Testpilot URL must use HTTPS or local HTTP and contain no credentials.');
 }
 if (!uuid.test(project) || !uuid.test(run)) throw new Error('Set TESTPILOT_PROJECT_ID and TESTPILOT_RUN_ID to full UUIDs.');
 return new URL(`/api/v1/projects/${project}/runs/${run}/automation-results`, url.origin);
}

function githubBuildUrl(env) {
 if (!env.GITHUB_SERVER_URL || !env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) return undefined;
 return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function commitUrl(env,commit) {
 if (!commit || !/^[a-f0-9]{7,80}$/i.test(commit)) return undefined;
 if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY) return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/commit/${commit}`;
 if (env.CI_PROJECT_URL) return `${env.CI_PROJECT_URL}/-/commit/${commit}`;
 return undefined;
}

function safeTestReference(value,token) {
 return value.replaceAll(token,'[redacted]').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,240);
}

function failureNote(result, expected, includeMessage, secret) {
 const reason = result.status === 'timedOut' ? 'Test timed out.' : `Expected ${expected}. Playwright reported ${result.status}.`;
 if (!includeMessage || !result.error?.message) return reason;
 const firstLine = result.error.message.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/, 1)[0];
 return (reason + '\n' + firstLine.replaceAll(secret, '[redacted]')).slice(0, 2000);
}

async function send(url, token, payload, {method = 'POST', attempts = 4, timeout = 20000} = {}) {
 const body = JSON.stringify(payload);
 for (let attempt = 0; attempt < attempts; attempt++) {
  let response;
  try {
   response = await fetch(url, {
    method, redirect: 'manual', signal: AbortSignal.timeout(timeout),
    headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    body,
   });
  } catch {
   if (attempt + 1 === attempts) throw Object.assign(new Error('Could not reach Testpilot.'),{transient:true});
   await delay(500 * 2 ** attempt);
   continue;
  }
  if (retryable.has(response.status) && attempt + 1 < attempts) {
   const retryAfter = Number(response.headers.get('retry-after'));
   await response.body?.cancel();
   await delay(retryAfter > 0 ? Math.min(60000, retryAfter * 1000) : 500 * 2 ** attempt);
   continue;
  }
  if (!response.ok) {
   const reference = response.headers.get('x-request-id');
   const problem = await response.json().catch(() => ({}));
   if (problem?.code === 'AUTOMATION_MODULE_REQUIRED') {
    throw new Error('Open Automation → Setup and select Set up Automation first.');
   }
   const hints = {
    AUTOMATION_RUN_NOT_FOUND:'The configured Testpilot run was not found.',
    AUTOMATION_RUN_INACTIVE:'The Testpilot target run is complete. Choose an active run.',
   };
   const message = hints[problem?.code] ?? (response.status === 401 ? 'Testpilot rejected the API key. Check the key and its issuing session.'
    : response.status === 403 ? 'The Testpilot key needs access to this workspace and permission to submit results.'
    : `Testpilot returned HTTP ${response.status}${reference && uuid.test(reference) ? ' (request ' + reference + ')' : ''}.`);
   throw Object.assign(new Error(message), {code:problem?.code, status:response.status,problem:problem?.error});
  }
  return (await response.json()).data;
 }
}

const queueDirectory = root => resolve(root,'artifacts','testpilot-pending');
const attachmentDirectory = (root,id) => resolve(queueDirectory(root),id+'-files');

async function clearPending(root,filename,deliveryId){
 await rm(filename,{force:true});
 const directory=attachmentDirectory(root,deliveryId);
 const relativePath=relative(queueDirectory(root),directory);
 if(!uuid.test(deliveryId)||relativePath!==deliveryId+'-files')throw new Error('Invalid pending artifact path.');
 await rm(directory,{recursive:true,force:true});
}

async function savePending(root, delivery, token) {
 const directory = queueDirectory(root);
 const filename = resolve(directory, delivery.completion.delivery_id + '.json');
 const temporary = filename + '.' + randomUUID() + '.tmp';
 const payload = JSON.stringify(delivery);
 if (payload.includes(token)) throw new Error('Testpilot upload data contains the API key. Check the runner configuration.');
 await mkdir(directory,{recursive:true,mode:0o700});
 try {
  await writeFile(temporary,payload,{mode:0o600});
  await rename(temporary,filename);
 } finally {await rm(temporary,{force:true})}
 return filename;
}

function outcomeLine(progress) {
 return `Tests: ${progress.passed} passed, ${progress.failed} failed, ${progress.skipped} skipped${progress.unmapped_count ? ', '+progress.unmapped_count+' unmapped' : ''}.`;
}

async function announceReport(root, completion, report, rejected = []) {
 const privateReport=process.env.TESTPILOT_PRIVATE_REPORT==='1';
 console.info(privateReport?'[Testpilot] Private report saved. Open Automation → Reports in Testpilot.':'[Testpilot] Report saved: '+report);
 const directory = resolve(root,'artifacts','testpilot-receipts');
 const filename = resolve(directory,completion.delivery_id+'.json');
 try {
  await mkdir(directory,{recursive:true});
  await writeFile(filename,JSON.stringify({
   delivery_id:completion.delivery_id, report_url:report,
   passed:completion.passed, failed:completion.failed, skipped:completion.skipped,
   unmapped:completion.unmapped_count??0, rejected,
  },null,2)+'\n');
 } catch {
  console.warn('[Testpilot] The report is saved, but the local receipt could not be written.');
 }
 if (process.env.GITHUB_STEP_SUMMARY && !privateReport) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
   '\n### Testpilot\n\n'+outcomeLine(completion)+(rejected.length ? ` ${rejected.length} rejected. Partial report.` : '')+' [Open the saved report]('+report+')\n').catch(()=>{
   console.warn('[Testpilot] The report is saved, but the GitHub job summary could not be updated.');
  });
 }
}

async function publishPending(delivery, token, onAccepted, beforeComplete) {
 const {origin, project, run, batches, completion} = delivery;
 const url = endpoint(origin, project, run);
 let published = 0;
 let receiptDetails = delivery.receiptDetails;
 const rejected = [];
 for (const batch of batches) {
  const receipts = await send(url, token, batch);
  if (!Array.isArray(receipts) || receipts.length !== batch.results.length) throw new Error('Testpilot returned an incomplete result receipt.');
  for (const [index,receipt] of receipts.entries()) {
   if (typeof receipt?.reason === 'string') receiptDetails = true;
   const ref = batch.results[index].case_id;
   const returned = typeof receipt?.case_id==='string' ? receipt.case_id.toLowerCase() : '';
   if (returned !== ref && !(caseCode.test(ref) && uuid.test(returned) && 'tc-'+returned.slice(0,8)===ref)) {
    throw new Error('Testpilot returned a receipt for a different test case.');
   }
   if (accepted.has(receipt.status)) {
    published++;
    await onAccepted?.(batch.results[index],receipt);
   } else {
    const reason = Object.hasOwn(rejectionHint,receipt.reason) ? receipt.reason : receipt.status;
    if (!Object.hasOwn(rejectionHint,reason)) throw new Error('Testpilot returned an unrecognized receipt.');
    rejected.push({case_id:ref,reason});
   }
  }
 }
 if (rejected.length && !receiptDetails) {
  if (!published) await send(new URL('automation-execution',url),token,{...completion,published,state:'publish_failed'},{method:'PUT',attempts:1,timeout:6000}).catch(()=>{});
  const error = new Error(rejectionSummary(published,rejected));
  error.terminal = !published;
  throw error;
 }
 await beforeComplete?.();
 const refs = new Map(batches.flatMap(batch=>batch.results.map(item=>[item.case_id,item.test_ref])));
 const mappingIssues = rejected.filter(item=>['not_in_run','ambiguous'].includes(item.reason)).slice(0,25)
  .map(item=>({...item,test_ref:refs.get(item.case_id)}));
 const rejectionDetails = rejected.length ? {rejected_count:rejected.length,rejected_results:rejected.slice(0,25),
  ...(mappingIssues.length?{mapping_issues:mappingIssues}:{})} : {};
 const state = !published && rejected.length ? 'publish_failed' : completion.state;
 const completionUrl = new URL('automation-execution',url);
 if (process.env.TESTPILOT_RELEASE_GATE==='1' && state==='completed') completionUrl.searchParams.set('gate','1');
 const final = await send(completionUrl, token, {...completion,...rejectionDetails,published,state}, {method:'PUT',attempts:3});
 if (completion.state !== 'completed' || !published) return {report:null,published,rejected};
 if (!uuid.test(final?.report_run_id ?? '')) throw new Error('Testpilot accepted the results but did not confirm a saved report.');
 const reportUrl = new URL('/',url);
 reportUrl.search = new URLSearchParams({project,view:'test-runs-results',run:final.report_run_id});
 return {report:reportUrl.href,published,rejected,gate:final.gate};
}

function enforceReleaseGate(report, gate) {
 if (!report) throw new Error('A saved Testpilot report is required for the release gate.');
 if (gate==='ready') {
  console.info('[Testpilot] Release gate passed.');
  return;
 }
 if (gate==='blocked') throw new Error('Release gate blocked: the report contains failed or blocked cases.');
 if (gate==='review') throw new Error('Release gate needs review: check missing coverage, skipped cases, or flaky tests.');
 throw new Error('Testpilot did not return a release gate decision.');
}

function rejectionSummary(published,rejected) {
 return `${published} accepted. ${rejected.length} ${rejected.length===1?'result':'results'} rejected. ${rejected.slice(0,10).map(item=>`${item.case_id} (${rejectionHint[item.reason]})`).join(', ')}.`;
}

export async function retryDelivery(root, deliveryId, target, token, {automatic=false} = {}) {
 if (!uuid.test(deliveryId)) throw new Error('Supply a valid Testpilot delivery ID.');
 const filename = resolve(queueDirectory(root),deliveryId+'.json');
 const delivery = JSON.parse(await readFile(filename,'utf8'));
 if (delivery.version!==1 || delivery.origin!==target.origin
     || (target.projectId && delivery.project!==target.projectId)
     || (target.runId && delivery.run!==target.runId)
     || (target.environment && delivery.completion?.build?.environment!==target.environment)
     || delivery.completion?.delivery_id!==deliveryId || !['completed','interrupted'].includes(delivery.completion.state)
     || !Array.isArray(delivery.batches) || !delivery.batches.length
     || delivery.batches.some(batch=>batch.delivery_id!==deliveryId || batch.destination!=='automation_module')) {
  if(automatic)return false;
  throw new Error('This pending delivery does not match the configured Testpilot target or format.');
 }
 console.info(`[Testpilot] Resuming delivery ${deliveryId}.`);
 const replay = artifactReplay(root,delivery,token);
 let result;
 try {result = await publishPending(delivery,token,replay.onAccepted)} catch (error) {
  if (error.terminal) await clearPending(root,filename,deliveryId);
  throw error;
 }
 const {report,published,rejected,gate} = result;
 if (!replay.pending) await clearPending(root,filename,deliveryId);
 if(replay.discarded)console.warn(`[Testpilot] ${replay.discarded} artifacts could not be recovered.`);
 console.info('[Testpilot] '+outcomeLine(delivery.completion));
 if (report) await announceReport(root,delivery.completion,report,rejected);
 if (rejected.length) throw new Error(rejectionSummary(published,rejected));
 if (replay.pending) throw new Error('The saved report is available. Some artifacts are still pending.');
 if (!automatic && process.env.TESTPILOT_RELEASE_GATE==='1') enforceReleaseGate(report,gate);
 return true;
}

function finalResult(test) {
 const result = test.results.at(-1);
 const declaredSkip = test.annotations.some(item => item.type === 'skip' || item.type === 'fixme');
 if (!result || result.status === 'interrupted' || result.workerIndex === -1 && !declaredSkip) return;
 const status = result.status === 'skipped' ? 'skipped' : result.status === test.expectedStatus ? 'passed' : 'failed';
 return {result, status};
}

function capturedSteps(result, secret) {
 const steps = [];
 function visit(children, depth) {
  for (const step of children) {
   if (step.category !== 'test.step') continue;
   if (steps.length === 30) return true;
   const title = step.title.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replaceAll(secret, '[redacted]')
    .replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 120) || 'Unnamed step';
   const status = step.error ? 'failed' : step.annotations?.some(item => item.type === 'skip') ? 'skipped' : 'passed';
   const duration = Math.min(86400000, Math.max(0, Math.round(step.duration) || 0));
   steps.push({title, depth: Math.min(depth, 4), status, duration_ms: duration});
   if (visit(step.steps, depth + 1)) return true;
  }
  return false;
 }
 const truncated = visit(result.steps ?? [], 0);
 return steps.length ? {steps, ...(truncated ? {steps_truncated: true} : {})} : {};
}

function* resultBatches(results) {
 let batch = [], size = 0;
 for (const result of results) {
  const bytes = Buffer.byteLength(JSON.stringify(result)) + 1;
  if (batch.length === 50 || size + bytes > 480000) {
   yield batch;
   batch = [];
   size = 0;
  }
  batch.push(result);
  size += bytes;
 }
 if (batch.length) yield batch;
}

function artifactInfo(attachment){
 const mime=attachment.contentType?.split(';')[0].toLowerCase();
 const extension=artifactExtensions[mime];
 if(extension)return {kind:mime.startsWith('image/')?'screenshot':'video',extension};
 if(['application/zip','application/x-zip-compressed'].includes(mime)&&attachment.name==='trace')return {kind:'trace',extension:'zip'};
}

async function artifactBytes(attachment){
 if(attachment.body)return attachment.body.length<=artifactLimit?attachment.body:null;
 if(!attachment.path)return null;
 const file=await open(attachment.path,'r');
 try{
  const {size}=await file.stat();
  if(!size||size>artifactLimit)return null;
  const buffer=Buffer.alloc(size);
  let offset=0;
  while(offset<size){
   const {bytesRead}=await file.read(buffer,offset,size-offset,offset);
   if(!bytesRead)return null;
   offset+=bytesRead;
  }
  return buffer;
 }finally{await file.close()}
}

async function stageArtifacts(root,deliveryId,attachments){
 const directory=attachmentDirectory(root,deliveryId);
 const manifest=Object.create(null);
 let skipped=0;
 let size=0;
 for(const [caseId,files] of attachments){
  const supported=files.filter(artifactInfo);
  skipped+=Math.max(0,supported.length-6);
  for(const [index,attachment] of supported.slice(0,6).entries()){
   const info=artifactInfo(attachment);
   try{
    const body=await artifactBytes(attachment);
    if(!body?.length || size+body.length>50*1024*1024){skipped++;continue;}
    const title=`playwright-${info.kind}-${index+1}.${info.extension}`;
    const digest=createHash('sha256').update(body).digest('hex');
    await mkdir(directory,{recursive:true,mode:0o700});
    const temporary=resolve(directory,randomUUID()+'.tmp');
    try{await writeFile(temporary,body,{mode:0o600});await rename(temporary,resolve(directory,digest));}
    finally{await rm(temporary,{force:true});}
    (manifest[caseId]??=[]).push({title,digest});
    size+=body.length;
   }catch{skipped++;}
  }
 }
 return {manifest,skipped};
}

function artifactReplay(root,delivery,token){
 const context={token,url:endpoint(delivery.origin,delivery.project,delivery.run)};
 const directory=attachmentDirectory(root,delivery.completion.delivery_id);
 const replay={pending:0,discarded:0,async onAccepted(result,receipt){
  const files=delivery.artifacts?.[result.case_id];
  if(!Array.isArray(files)||!files.length)return;
  if(!uuid.test(receipt.attempt_id??'')){replay.pending+=files.length;return;}
  for(const file of files.slice(0,6)){
   const {title,digest}=file??{};
   if(!/^[a-f0-9]{64}$/.test(digest)||!/^playwright-(screenshot|video|trace)-[1-6]\.(png|jpg|jpeg|webp|webm|mp4|zip)$/.test(title)){replay.discarded++;continue;}
   let body;
   try{body=await artifactBytes({path:resolve(directory,digest)});}catch{replay.discarded++;continue;}
   if(!body||createHash('sha256').update(body).digest('hex')!==digest){replay.discarded++;continue;}
   const result=await uploadArtifact(context,receipt.attempt_id,title,digest,body);
   if(result==='pending')replay.pending++;
   if(result==='discarded')replay.discarded++;
  }
 }};
 return replay;
}

async function uploadArtifact(context,attempt,title,sha256,body){
 const url=new URL('automation-artifacts/'+attempt,context.url);
 const runId=context.url.pathname.split('/').at(-2);
   const hash=createHash('sha256').update(attempt+'/'+title+'/'+sha256).digest('hex');
   const requestId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
   const headers={Authorization:'Bearer '+context.token,'Content-Type':'application/octet-stream',
    'Idempotency-Key':requestId,'X-Evidence-Metadata':encodeURIComponent(JSON.stringify({
     title,caption:'',request_id:requestId,size:body.length,sha256,run_id:runId,
    }))};
   for(let retry=0;retry<3;retry++){
    const response=await fetch(url,{method:'POST',headers,body,redirect:'manual',signal:AbortSignal.timeout(25000)}).catch(()=>null);
    await response?.body?.cancel().catch(()=>{});
    if(response?.ok)return 'saved';
    if(response&&[400,404,410,415,422].includes(response.status))return 'discarded';
    if(retry===2||(response&&!retryable.has(response.status)&&response.status!==409))return 'pending';
    await delay(500*2**retry);
   }
}

export async function resumePending(root,target,token,limit=3){
 const files=await readdir(queueDirectory(root),{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error});
 let checked=0;
 for(const file of files){
  if(!file.isFile()||!file.name.endsWith('.json')||!uuid.test(file.name.slice(0,-5)))continue;
  const id=file.name.slice(0,-5);
  try{if(await retryDelivery(root,id,target,token,{automatic:true}))checked++;}
  catch(error){
   if(error.code==='ENOENT')continue;
   checked++;
   console.warn(`[Testpilot] Could not finish recovering ${id}. ${error.message.replaceAll(token,'[redacted]')}`);
   if(error.transient||retryable.has(error.status))break;
  }
  if(checked>=limit)break;
 }
}

export default class TestpilotReporter {
 constructor(options = {}) {
  this.options = options;
  this.delivery = uuid.test(process.env.TESTPILOT_MERGED_DELIVERY_ID??'') ? process.env.TESTPILOT_MERGED_DELIVERY_ID : randomUUID();
  this.tests = [];
  this.running = new Set();
  this.sequence = 0;
  this.lastUpdate = 0;
 }

 onBegin(config, suite) {
  this.tests = suite.allTests();
  this.root = process.env.TESTPILOT_REPORTER_ROOT || (config.configFile ? dirname(config.configFile) : config.rootDir);
  this.configurations = [...new Set(this.tests.map(test=>test.parent.project()?.name?.trim().slice(0,160))
   .filter(name=>name && (!this.options.playwrightProject || name===this.options.playwrightProject)))].slice(0,24);
  const [major,minor] = (config.version??'').split('.').map(Number);
  this.compatible = major>1 || major===1 && minor>=55 || !config.version;
  if (this.listOnly()) {
   const tests=[...new Set(this.tests.map(test=>mappingKey(test,this.root)))];
   const discoveryFile=this.options.discoveryFile??process.env.TESTPILOT_DISCOVERY_FILE;
   if(discoveryFile)writeFileSync(resolve(this.root,discoveryFile),JSON.stringify({tests},null,2)+'\n');
   for(const key of tests)console.info(key);
  }
 }

 printsToStdio() {
  return false;
 }

 onTestBegin(test) {
  this.running.add(test);
  if (this.listOnly() || process.env.TESTPILOT_MERGED_DELIVERY_ID) return;
  if (!this.timer) {
   this.timer = setInterval(() => this.updateProgress(), 12000);
   this.timer.unref();
  }
  this.updateProgress();
 }

 onTestEnd(test) {
  this.running.delete(test);
  this.updateProgress();
 }

 listOnly() {
  return this.options.listMappings || process.env.TESTPILOT_LIST_MAPPINGS === '1';
 }

 context() {
  this.preparation ??= this.prepare().then(value => ({value}), error => ({error}));
  return this.preparation;
 }

 async prepare() {
   const env = process.env;
   const options = this.options;
   if (!this.compatible) throw new Error(`Testpilot reporter ${reporterVersion} requires Playwright 1.55 or newer.`);
   const token = env.TESTPILOT_API_KEY?.trim();
   if (!token) throw new Error('Set TESTPILOT_API_KEY to a Testpilot result-write API key.');
   const mappings = await loadMappings(this.root, options.mapFile ?? env.TESTPILOT_MAP_FILE);
   const url = endpoint(options.baseURL ?? env.TESTPILOT_URL ?? 'https://testpilot.ng',
    options.projectId ?? env.TESTPILOT_PROJECT_ID ?? '', options.runId ?? env.TESTPILOT_RUN_ID ?? '');
   const isCI = Boolean(env.CI && env.CI !== 'false' && env.CI !== '0' || env.GITHUB_RUN_ID || env.CI_PIPELINE_ID || env.TESTPILOT_MERGED_DELIVERY_ID);
   const commit = options.commit ?? env.TESTPILOT_COMMIT ?? env.GITHUB_SHA ?? env.CI_COMMIT_SHA;
   const build = {
    runner: 'Playwright',
    source: isCI ? 'ci' : 'local',
    build: options.build ?? env.TESTPILOT_BUILD ?? env.GITHUB_RUN_ID ?? env.CI_PIPELINE_ID ?? this.delivery,
    commit,
    commit_url: options.commitUrl ?? env.TESTPILOT_COMMIT_URL ?? commitUrl(env,commit),
    environment: options.environment ?? (env.TESTPILOT_ENVIRONMENT || (isCI ? 'CI' : 'Local')),
    build_url: options.buildUrl ?? env.TESTPILOT_BUILD_URL ?? githubBuildUrl(env) ?? env.CI_PIPELINE_URL,
   };
   if (env.TESTPILOT_PREFLIGHT_SUPPORTED === '1') {
    const branch = (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || env.CI_COMMIT_REF_NAME)?.trim().slice(0,200);
    if (branch) build.branch = safeTestReference(branch,token);
   }
   const artifactUrl = options.artifactUrl ?? env.TESTPILOT_ARTIFACT_URL;
   const usedCases = new Set();
   const mapped = new Map();
   const unmapped = [];
   for (const test of this.tests) {
    const configuration = test.parent.project()?.name || undefined;
    if (options.playwrightProject && configuration !== options.playwrightProject) continue;
    const ids = new Set(test.annotations.filter(item => item.type === 'testpilot').map(item => item.description?.trim().toLowerCase()));
    const key = mappingKey(test, this.root);
    if (Object.hasOwn(mappings, key)) ids.add(mappings[key].toLowerCase());
    const testRef=safeTestReference(key,token);
    if (!ids.size) {unmapped.push(testRef);continue;}
    const [caseId] = ids;
    if (ids.size !== 1 || !caseId || !uuid.test(caseId) && !caseCode.test(caseId)) {
     throw new Error(`Give ${testRef} one valid Testpilot case ID. Check the mapping file and annotations for conflicts.`);
    }
    if (usedCases.has(caseId)) throw new Error(`Multiple tests map to ${caseId}. Map one test per case for this run, or use separate targets for each browser.`);
    usedCases.add(caseId);
    mapped.set(test, {caseId, configuration, testRef});
   }
   return {token, url, progressUrl: new URL('automation-execution', url), build, artifactUrl, mapped,unmapped,mappingIssues:[]};
 }

 progressPayload(context, state, published = 0) {
  const counts = {passed: 0, failed: 0, skipped: 0};
  const runningCases = [];
  for (const [test, {caseId}] of context.mapped) {
   if (state === 'running' && this.running.has(test)) {
    runningCases.push(caseId);
    continue;
   }
   const final = finalResult(test);
   if (!final) continue;
   if (state === 'running' && final.status === 'failed' && final.result.retry < test.retries) continue;
   counts[final.status]++;
  }
  return {delivery_id: this.delivery, sequence: ++this.sequence, state, build: context.build,
   total: context.mapped.size, ...counts, published, running_case_ids: runningCases.slice(0, 50),
   ...(context.unmapped.length?{unmapped_count:context.unmapped.length,unmapped_tests:context.unmapped.slice(0,25)}:{}),
   ...(context.mappingIssues.length?{mapping_issues:context.mappingIssues}:{}),
   ...(this.configurations.length?{expected_configurations:this.configurations}:{}),
  };
 }

 progress(context,state,published=0) {
  const live = state === 'running' || state === 'publishing';
  return send(context.progressUrl, context.token, this.progressPayload(context,state,published), {method: 'PUT', attempts: live ? 1 : 3, timeout: live ? 6000 : 20000});
 }

 updateProgress() {
  if (this.listOnly() || process.env.TESTPILOT_PREFLIGHT === '1' || process.env.TESTPILOT_MERGED_DELIVERY_ID || this.ending || this.inFlight || Date.now() - this.lastUpdate < 2500) return;
  this.lastUpdate = Date.now();
  this.inFlight = this.context().then(async ({value}) => {
   if (value&&(value.mapped.size||value.unmapped.length)&&!this.ending) await this.progress(value, 'running');
  }).catch(() => {
   if (!this.reportedProgressError) console.warn('[Testpilot] Live progress is temporarily unavailable.');
   this.reportedProgressError = true;
  }).finally(() => {this.inFlight = undefined});
 }

 async preflight() {
  const {value:context,error} = await this.context();
  if (error) throw error;
  const recover = async () => {
   if(process.env.TESTPILOT_RESUME_PENDING!=='1')return;
   const [,,,,projectId,,runId]=context.url.pathname.split('/');
   await resumePending(this.root,{origin:context.url.origin,projectId,runId,environment:context.build.environment},context.token);
  };
   if (context.unmapped.length && process.env.TESTPILOT_PUBLISH !== 'best-effort') {
    throw new Error(`${context.unmapped.length} selected tests lack a Testpilot mapping. Map them first or use TESTPILOT_PUBLISH=local-only. ${context.unmapped.slice(0,3).join(', ')}`);
  }
  const cases = [...context.mapped.values()].map(({caseId,configuration})=>({case_id:caseId,configuration}));
  if (!cases.length) throw new Error('No selected tests have a Testpilot case mapping.');
  let target;
  let foundIssues = false;
  for (let offset=0; offset<cases.length; offset+=500) {
   try {
    target = await send(new URL('automation-preflight',context.url), context.token,
     {environment:context.build.environment,cases:cases.slice(offset,offset+500)}, {attempts:2,timeout:8000});
   } catch (error) {
    // Older Testpilot servers return METHOD_NOT_ALLOWED for unknown run actions.
    const unsupported = error.code === 'METHOD_NOT_ALLOWED' && error.status === 405;
    const legacyScopeGate = error.status===403 && error.problem==='This API key does not allow this operation';
    if (!unsupported && !legacyScopeGate) throw error;
    const check = await fetch(new URL('../../integration-check',context.url),{
     headers:{Authorization:'Bearer '+context.token},redirect:'manual',signal:AbortSignal.timeout(8000),
    });
    const response = await check.json().catch(()=>null);
    if (!check.ok || !response?.data?.scopes?.some(scope=>scope==='record_result'||scope==='*')) {
     throw new Error('Testpilot could not verify this key. Check its scope and issuing session.',{cause:error});
    }
    console.info('[Testpilot] API key and local mappings checked. This server does not yet support target validation.');
    await recover();
    return false;
   }
   if (!Array.isArray(target?.issues)) throw new Error('Testpilot returned an incomplete preflight response.');
   if(offset===0)await recover();
   if (target.issues.length) {
    const messages = target.issues.slice(0,8).map(issue=>{
     const reason = {
      environment_mismatch:process.env.TESTPILOT_PRIVATE_REPORT==='1'?'environment mismatch':`environment mismatch (expected "${issue.expected}", configured "${context.build.environment}")`,
      configuration_mismatch:`browser configuration mismatch (expected "${issue.expected || 'default'}")`,
      manual_result:'existing manual result is protected',
      duplicate_mapping:'multiple tests map to the same case',
      ambiguous:'case ID matches more than one case',
      not_in_run:'case missing from the active run or Automation module',
     }[issue.reason] ?? 'target validation failed';
     return `${issue.case_id}: ${reason}`;
    });
    const message = messages.join('\n').replaceAll(context.token,'[redacted]');
    if (process.env.TESTPILOT_PUBLISH !== 'best-effort') throw new Error(message);
    foundIssues = true;
    console.warn('[Testpilot] Some results may be rejected. '+message);
   }
  }
  const unmapped = context.unmapped.length ? ` ${context.unmapped.length} unmapped tests will stay in Playwright.` : '';
  const action = foundIssues?'Attempting to publish':'Ready to publish';
  const destination = process.env.TESTPILOT_PRIVATE_REPORT==='1' ? '' : ` to ${target.run_name} · ${context.build.environment}`;
  console.info((`[Testpilot] ${action} ${cases.length} mapped test(s)${destination}.`+unmapped).replaceAll(context.token,'[redacted]'));
  return target.receipt_details === true;
 }

 async onEnd(run) {
  if (this.listOnly()) return;
  if (process.env.TESTPILOT_PREFLIGHT === '1') {
   if (run.status!=='passed' && !process.env.TESTPILOT_MERGED_DELIVERY_ID) return;
   const resultFile = process.env.TESTPILOT_PREFLIGHT_RESULT;
   try {
    const supported = await this.preflight();
    if (resultFile) writeFileSync(resultFile,supported ? 'supported' : 'legacy');
   } catch (error) {
    if (resultFile) writeFileSync(resultFile,error.transient || retryable.has(error.status) ? 'transient' : 'invalid');
    console.error('[Testpilot] Preflight failed. '+error.message);
    return {status:'failed'};
   }
   return;
  }
  this.ending = true;
  clearInterval(this.timer);
  await this.inFlight;
  let pendingFile;
  let completion;
  let published=0;
  let progressTimer;
  let progressUpdate;
  const mergeResult = process.env.TESTPILOT_MERGE_RESULT;
  const recordMerge = status => {if (mergeResult) writeFileSync(mergeResult,status)};
  const stopProgress = async () => {
   clearInterval(progressTimer);
   await progressUpdate;
  };
  try {
   const prepared = await this.context();
   if (prepared.error) throw prepared.error;
   const context = prepared.value;
   const {token, url, build, artifactUrl, mapped} = context;
   const groups = new Map();
   const attachments=new Map();
   for (const [test, {caseId, configuration, testRef}] of mapped) {
    const final = finalResult(test);
    if (!final) continue;
    const {result, status} = final;
    const flaky = test.outcome() === 'flaky';
    const diagnostic = status === 'failed' ? result : flaky
     ? test.results.find(attempt => attempt.status !== test.expectedStatus) : undefined;
    if(this.options.captureArtifacts===true&&diagnostic?.attachments?.length)attachments.set(caseId,diagnostic.attachments);
    const entry = {
     case_id: caseId, status, retries: result.retry, flaky, test_ref:testRef,
     duration_ms: result.duration,
     finished_at: new Date(result.startTime.getTime() + result.duration).toISOString(),
     failure: diagnostic ? failureNote(diagnostic, test.expectedStatus, this.options.includeFailureMessage === true, token) : '',
     artifact_url: diagnostic ? artifactUrl : undefined,
     ...(this.options.captureSteps === false ? {} : capturedSteps(result, token)),
    };
    const group = groups.get(configuration) ?? [];
    group.push(entry);
    groups.set(configuration, group);
   }
   const batches = [...groups].flatMap(([configuration,results]) => [...resultBatches(results)].map(batch=>({
    delivery_id:this.delivery,destination:'automation_module',build:{...build,configuration},results:batch,
   })));
   if (!batches.length) {
    if (mapped.size||context.unmapped.length) {
     await this.progress(context,run.status==='interrupted'?'interrupted':'completed');
    }
    console.info('[Testpilot] No mapped outcomes to publish.');
    recordMerge('failed');
    if (process.env.TESTPILOT_RELEASE_GATE==='1') return {status:'failed'};
    return;
   }
   const [, , , , project, , targetRun] = url.pathname.split('/');
   const publishing = this.progressPayload(context,'publishing');
   completion = this.progressPayload(context,run.status==='interrupted'?'interrupted':'completed');
   // Reserve the terminal sequence so a saved retry always follows live updates.
   completion.sequence = 10_000_000;
   const staged=await stageArtifacts(this.root,this.delivery,attachments);
   const delivery = {version:1,origin:url.origin,project,run:targetRun,batches,completion,artifacts:staged.manifest,receiptDetails:process.env.TESTPILOT_PREFLIGHT_SUPPORTED==='1'};
   pendingFile = await savePending(this.root,delivery,token);
   await send(context.progressUrl,token,publishing,{method:'PUT',attempts:1,timeout:6000}).catch(()=>{});
   progressTimer = setInterval(()=>{
    if (progressUpdate) return;
    progressUpdate = this.progress(context,'publishing',published).catch(()=>{}).finally(()=>{progressUpdate=undefined});
   },12000);
   progressTimer.unref();
   const replay=artifactReplay(this.root,delivery,token);
   const result = await publishPending(delivery,token,async (result,receipt)=>{
    published++;
    await replay.onAccepted(result,receipt);
   },stopProgress);
   const missedArtifacts=staged.skipped+replay.discarded;
   if(!replay.pending)await clearPending(this.root,pendingFile,this.delivery);
   else console.warn(`[Testpilot] ${replay.pending} artifacts are queued for recovery with delivery ${this.delivery}.`);
   console.info('[Testpilot] '+outcomeLine(completion));
   console.info(`[Testpilot] ${result.published} ${result.published===1?'result':'results'} accepted.`);
   if (result.report) {
    const link = result.report.replaceAll('&','&amp;').replaceAll('"','&quot;');
    const receipt = resolve(this.root,'artifacts','testpilot-receipts',completion.delivery_id+'.html');
    const html = `<!doctype html><meta charset="utf-8"><title>Testpilot report</title><p><a href="${link}">Open the saved Testpilot report</a></p>`;
    const receiptFile = await mkdir(dirname(receipt),{recursive:true}).then(()=>writeFile(receipt,html)).then(()=>receipt,()=>null);
    for (const test of mapped.keys()) {
     const last = finalResult(test)?.result;
     if (!last) continue;
     const annotation = {type:'Testpilot report',description:result.report};
     test.annotations.push(annotation);
     if (last.annotations && last.annotations!==test.annotations) last.annotations.push(annotation);
     if (receiptFile) last.attachments.push({name:'Open Testpilot report',contentType:'text/html',path:receiptFile});
    }
    await announceReport(this.root,completion,result.report,result.rejected);
   } else if (completion.state==='interrupted') console.info('[Testpilot] Execution interrupted. Available results were uploaded without a report.');
   if (result.rejected.length) {
    recordMerge('partial');
    console.error('[Testpilot] '+rejectionSummary(result.published,result.rejected));
    if (process.env.TESTPILOT_PUBLISH !== 'best-effort') return {status:'failed'};
   } else recordMerge(result.report?'published':'interrupted');
   if (process.env.TESTPILOT_RELEASE_GATE==='1') {
    try {
     enforceReleaseGate(result.report,result.gate);
    } catch (error) {
     console.error('[Testpilot] '+error.message);
     recordMerge('gate_failed');
     return {status:'failed'};
    }
   }
   if (missedArtifacts) console.warn('[Testpilot] '+missedArtifacts+' artifacts could not be uploaded.');
  } catch (error) {
   recordMerge('failed');
   await stopProgress();
   if (completion) console.info('[Testpilot] '+outcomeLine(completion));
   console.error('[Testpilot] '+(error instanceof Error ? error.message : 'Publishing failed.'));
   if (pendingFile && error.terminal) await clearPending(this.root,pendingFile,this.delivery);
   else if (pendingFile) console.error('[Testpilot] Upload pending. Retry without rerunning tests: npm run testpilot:retry -- '+this.delivery);
   if (process.env.TESTPILOT_PUBLISH !== 'best-effort' || process.env.TESTPILOT_RELEASE_GATE==='1') return {status:'failed'};
  }
 }
}
