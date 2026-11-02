import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

interface ReportResult {
  status: string;
  errors: { message?: string }[];
  attachments: { name: string; body?: string; path?: string }[];
}
interface ReportSuite {
  suites?: ReportSuite[];
  specs?: { tests: { results: ReportResult[] }[] }[];
}

function results(suite: ReportSuite): ReportResult[] {
  return [
    ...(suite.specs ?? []).flatMap(spec => spec.tests.flatMap(item => item.results)),
    ...(suite.suites ?? []).flatMap(results),
  ];
}

async function checkFixture(scenario: 'timeout' | 'cleanup-failure' | 'auth-failure' | 'recovery') {
  const projectRoot = resolve(__dirname, '..');
  const artifactsRoot = join(projectRoot, 'artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const temporary = await mkdtemp(join(artifactsRoot, 'fixture-check-'));
  const calls: string[] = [];
  let booking: Record<string, unknown> | undefined;
  let deleted = false;
  let serverError: unknown;
  const server = createServer((request, response) => {
    void (async () => {
      calls.push(`${request.method} ${request.url}`);
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'POST' && request.url === '/auth') {
        response.end(JSON.stringify(scenario === 'auth-failure'
          ? { reason: 'Bad credentials' } : { token: 'offline-token' }));
      } else if (request.method === 'POST' && request.url === '/record') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        booking = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        response.end('{}');
      } else if (request.method === 'GET' && request.url?.startsWith('/booking?')) {
        const query = new URL(request.url, 'http://localhost').searchParams;
        assert.equal(query.get('firstname'), booking?.firstname);
        assert.equal(query.get('lastname'), booking?.lastname);
        response.end(JSON.stringify([{ bookingid: 42 }]));
      } else if (request.method === 'GET' && request.url === '/booking/42') {
        response.statusCode = deleted ? 404 : 200;
        response.end(JSON.stringify(deleted ? {} : booking));
      } else if (request.method === 'DELETE' && request.url === '/booking/42') {
        assert.equal(request.headers.cookie, 'token=offline-token', 'Cleanup must use the auth fixture token');
        response.statusCode = scenario === 'cleanup-failure' ? 403 : 201;
        deleted = response.statusCode === 201;
        response.end('{}');
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    })().catch((error: unknown) => {
      serverError = error;
      response.statusCode = 500;
      response.end('{}');
    });
  });

  try {
    await new Promise<void>((resolveReady, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveReady);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const reportPath = join(temporary, 'report.json');
    const configPath = join(temporary, 'playwright.config.ts');
    const fixturePath = join(projectRoot, 'fixtures', 'booking.fixture').replaceAll('\\', '/');
    await writeFile(configPath, `
      import { defineConfig } from '@playwright/test';
      export default defineConfig({
        testDir: ${JSON.stringify(temporary)}, testMatch: 'fixture.spec.ts',
        outputDir: ${JSON.stringify(join(temporary, 'results'))},
        timeout: 10_000, retries: 0, workers: 1,
        reporter: [['json', { outputFile: ${JSON.stringify(reportPath)} }]],
        use: { baseURL: 'http://127.0.0.1:${address.port}', trace: 'off' },
      });
    `);
    await writeFile(join(temporary, 'fixture.spec.ts'), `
      import { test, expect } from ${JSON.stringify(fixturePath)};
      test('injected ${scenario}', async ({ request, ownedBooking }) => {
        ownedBooking.beginCreation();
        ${scenario === 'recovery' ? '' : 'ownedBooking.recordCreatedId(42);'}
        await request.post('/record', { data: ownedBooking.payload });
        ${scenario === 'timeout'
    // Deliberately stall the BODY to prove the real fixture retains teardown time.
    ? 'test.setTimeout(500); await new Promise<void>(() => {});'
    : "expect(false, 'injected primary body failure').toBe(true);"}
      });
    `);

    const child = spawn(process.execPath, [
      join(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test', '--config', configPath,
    ], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(20_000) });
    let output = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    });
    assert.equal(exitCode, 1, `Injected failure must fail the child run: ${output}`);
    assert.equal(serverError, undefined);
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as ReportSuite;
    const recorded = results(report);
    assert.equal(recorded.length, 1, 'Run once without retries');
    const result = recorded[0];
    if (scenario === 'auth-failure') {
      assert.equal(result.status, 'failed');
      assert.match(result.errors.map(error => error.message).join('\n'), /POST \/auth must return a non-empty token/);
      assert.deepEqual(calls, ['POST /auth'], 'Failed authentication blocks booking creation');
      assert.equal(result.attachments.some(item => item.name === 'booking-lifecycle'), false);
      return;
    }
    const lifecycle = result.attachments.find(item => item.name === 'booking-lifecycle');
    assert.ok(lifecycle, 'Real fixture must attach its cleanup outcome');
    const attachment = lifecycle.body
      ? Buffer.from(lifecycle.body, 'base64').toString()
      : await readFile(lifecycle.path!, 'utf8');
    const cleanup = JSON.parse(attachment) as { outcome: string; marker: string; bookingId: number };
    assert.equal(cleanup.bookingId, 42);
    assert.equal(cleanup.marker, booking?.lastname, 'Attachment retains the test-owned identity');
    if (scenario === 'timeout') {
      assert.equal(result.status, 'timedOut');
      assert.match(result.errors.map(error => error.message).join('\n'), /timeout/i);
      assert.equal(cleanup.outcome, 'deleted');
      assert.deepEqual(calls, ['POST /auth', 'POST /record', 'GET /booking/42', 'DELETE /booking/42', 'GET /booking/42']);
      assert.equal(deleted, true);
    } else if (scenario === 'recovery') {
      assert.equal(result.status, 'failed', 'Recovery must not hide the primary failure');
      assert.match(result.errors.map(error => error.message).join('\n'), /injected primary body failure/);
      assert.equal(cleanup.outcome, 'deleted');
      assert.deepEqual(calls.map(call => call.split('?')[0]),
        ['POST /auth', 'POST /record', 'GET /booking', 'GET /booking/42', 'DELETE /booking/42', 'GET /booking/42']);
      assert.equal(deleted, true);
    } else {
      assert.equal(result.status, 'failed');
      const errors = result.errors.map(error => error.message).join('\n');
      assert.match(errors, /injected primary body failure/);
      assert.match(errors, /Cleanup: DELETE .* must return 201/);
      assert.equal(cleanup.outcome, 'unresolved');
      assert.deepEqual(calls, ['POST /auth', 'POST /record', 'GET /booking/42', 'DELETE /booking/42']);
      assert.equal(deleted, false);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolveClosed => server.close(() => resolveClosed()));
    // Verify the exact owned temporary directory before recursive removal on Windows.
    assert.equal(dirname(resolve(temporary)), resolve(artifactsRoot));
    await rm(temporary, { recursive: true, force: true });
  }
}

void test('real booking fixture cleans up after the test body times out', () => checkFixture('timeout'));
void test('real booking fixture reports both body and cleanup failures', () => checkFixture('cleanup-failure'));
void test('API auth failure blocks the test before any booking is created', () => checkFixture('auth-failure'));
void test('real booking fixture recovers a missing creation ID using its private owner marker', () => checkFixture('recovery'));
