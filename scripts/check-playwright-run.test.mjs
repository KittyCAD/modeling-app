import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fixture(t, attempts, saved) {
  const dir = mkdtempSync(path.join(tmpdir(), 'playwright-run-check-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const name of ['scripts', 'test-results', 'bin'])
    mkdirSync(path.join(dir, name))
  copyFileSync(
    path.join(repo, 'scripts/check-playwright-run.mjs'),
    path.join(dir, 'scripts/check-playwright-run.mjs')
  )
  copyFileSync(
    path.join(repo, 'playwrightProcess.mjs'),
    path.join(dir, 'playwrightProcess.mjs')
  )
  writeFileSync(path.join(dir, 'attempts.json'), JSON.stringify(attempts))
  writeFileSync(
    path.join(dir, 'bin/npm'),
    `#!${process.execPath}
const fs = require('node:fs');
const attempts = JSON.parse(fs.readFileSync('attempts.json', 'utf8'));
const count = fs.existsSync('calls') ? Number(fs.readFileSync('calls', 'utf8')) : 0;
const attempt = attempts[count];
fs.writeFileSync('calls', String(count + 1));
const invocations = fs.existsSync('invocations.json') ? JSON.parse(fs.readFileSync('invocations.json', 'utf8')) : [];
invocations.push(process.argv.slice(2));
fs.writeFileSync('invocations.json', JSON.stringify(invocations));
if (!attempt) process.exit(99);
fs.writeFileSync('test-results/.last-run.json', JSON.stringify({ status: attempt.status, failedTests: attempt.status === 'failed' ? ['test-id'] : [] }));
fs.writeFileSync('test-results/report.json', JSON.stringify({ suites: [], errors: attempt.errors }));
process.exit(attempt.exitCode ?? (attempt.status === 'failed' ? 1 : 0));
`,
    { mode: 0o755 }
  )
  if (saved) {
    writeFileSync(
      path.join(dir, 'test-results/.last-run.json'),
      JSON.stringify({ status: saved.status, failedTests: [] })
    )
    writeFileSync(
      path.join(dir, 'test-results/report.json'),
      JSON.stringify({ suites: [], errors: saved.errors })
    )
  }
  const run = () =>
    spawnSync(
      'bash',
      [
        path.join(repo, '.github/ci-cd-scripts/playwright-electron.sh'),
        '1',
        '6',
        'windows',
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`,
          GITHUB_OUTPUT: path.join(dir, 'github-output'),
        },
        encoding: 'utf8',
        timeout: 10_000,
      }
    )
  return {
    dir,
    run,
    calls: () => Number(readFileSync(path.join(dir, 'calls'), 'utf8')),
    invocations: () =>
      JSON.parse(readFileSync(path.join(dir, 'invocations.json'), 'utf8')),
  }
}

const passed = { status: 'passed', errors: [] }
const testFailure = { status: 'failed', errors: [] }
const teardownFailure = {
  status: 'passed',
  errors: [{ message: 'Worker teardown timeout of 120000ms exceeded.' }],
  exitCode: 1,
}

test('passes a successful run', (t) => {
  const f = fixture(t, [passed])
  assert.equal(f.run().status, 0)
  assert.equal(f.calls(), 1)
})

test('retains the one retry for individual test failures', (t) => {
  const f = fixture(t, [testFailure, passed])
  assert.equal(f.run().status, 0)
  assert.equal(f.calls(), 2)
  assert.ok(f.invocations()[1].includes('--last-failed'))
})

test('reruns the full shard after a global error', (t) => {
  const f = fixture(t, [teardownFailure, passed])
  const result = f.run()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Worker teardown timeout/)
  assert.equal(f.calls(), 1)
  assert.equal(f.run().status, 0)
  assert.equal(f.calls(), 2)
  assert.ok(f.invocations()[1].includes('--shard=1/6'))
  assert.ok(!f.invocations()[1].includes('--last-failed'))
})

test('reruns the full shard after a last-failed retry has a global error', (t) => {
  const f = fixture(t, [testFailure, teardownFailure, passed])
  assert.equal(f.run().status, 1)
  assert.equal(f.calls(), 2)
  assert.equal(f.run().status, 0)
  assert.equal(f.calls(), 3)
  assert.ok(f.invocations()[2].includes('--shard=1/6'))
  assert.ok(!f.invocations()[2].includes('--last-failed'))
})

test('reruns the full shard when restored results have a global error', (t) => {
  const f = fixture(t, [passed], {
    ...teardownFailure,
    status: 'failed',
  })
  assert.equal(f.run().status, 0)
  assert.equal(f.calls(), 1)
  assert.ok(f.invocations()[0].includes('--shard=1/6'))
  assert.ok(!f.invocations()[0].includes('--last-failed'))
})

test('fails closed for an incomplete or missing saved report', (t) => {
  const f = fixture(t, [], { ...passed, status: 'interrupted' })
  assert.equal(f.run().status, 1)
  rmSync(path.join(f.dir, 'test-results/report.json'))
  assert.equal(f.run().status, 1)
})
