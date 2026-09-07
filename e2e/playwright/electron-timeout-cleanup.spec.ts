import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'

test(
  'a timed-out Electron test stays failed without poisoning worker teardown',
  { tag: ['@desktop', '@macos', '@windows'] },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a fixture pattern.
  async ({}, testInfo) => {
    const root = process.cwd()
    const directory = testInfo.outputPath('timeout-worker')
    await mkdir(directory, { recursive: true })
    await copyFile(
      path.join(root, 'e2e/playwright/fixtures/electron-timeout-worker.ts'),
      path.join(directory, 'timeout-worker.spec.ts')
    )
    await writeFile(
      path.join(directory, 'fixture-app.cjs'),
      `const { app, BrowserWindow } = require('electron')
let window
app.whenReady().then(() => {
  window = new BrowserWindow({ show: false })
  window.loadURL('data:text/html,<body>Fixture timeout regression</body>')
})
`
    )
    await writeFile(
      path.join(directory, 'playwright.config.cjs'),
      `module.exports = ${JSON.stringify({
        testDir: directory,
        testMatch: 'timeout-worker.spec.ts',
        tsconfig: path.join(root, 'tsconfig.json'),
        workers: 1,
        retries: 0,
        timeout: 10_000,
        globalTimeout: 45_000,
        outputDir: path.join(directory, 'results'),
        reporter: [
          ['json', { outputFile: path.join(directory, 'report.json') }],
        ],
        use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
      })}`
    )

    const child = spawn(
      process.execPath,
      [
        path.join(root, 'node_modules/playwright/cli.js'),
        'test',
        '--config',
        path.join(directory, 'playwright.config.cjs'),
      ],
      {
        cwd: directory,
        env: { ...process.env, TARGET: 'desktop' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    await testInfo.attach('nested-run-output', {
      body: output,
      contentType: 'text/plain',
    })
    const reportPath = path.join(directory, 'report.json')
    await testInfo.attach('nested-timeout-report', {
      path: reportPath,
      contentType: 'application/json',
    })
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(exitCode, output).toBe(1)
    expect(report.errors).toEqual([])
    expect(report.stats).toMatchObject({
      expected: 1,
      unexpected: 1,
      flaky: 0,
      skipped: 0,
    })
    const results = report.suites[0].specs.map(
      (spec: {
        tests: {
          results: { status: string; errors: { message: string }[] }[]
        }[]
      }) => spec.tests[0].results[0]
    )
    expect(results[0].status).toBe('timedOut')
    expect(results[0].errors[0].message).toContain(
      'Test timeout of 10000ms exceeded'
    )
    // Closing the page can also reject the test's outstanding reload. It must
    // not add fixture teardown errors or replace the original timeout.
    for (const error of results[0].errors.slice(1)) {
      expect(error.message).toContain(
        'page.reload: Target page, context or browser has been closed'
      )
    }
    expect(results[1].status).toBe('passed')

    const events = (
      await readFile(path.join(directory, 'process-events.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const launches = events.filter((event) => event.event === 'launch')
    const exits = events.filter((event) => event.event === 'exit')
    expect(launches).toHaveLength(2)
    expect(launches[0].worker).not.toBe(launches[1].worker)
    expect(exits).toEqual(
      expect.arrayContaining(
        launches.map((launch) => ({
          ...launch,
          event: 'exit',
          code: 0,
          signal: null,
        }))
      )
    )
  }
)
