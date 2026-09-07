// Copied into an isolated nested Playwright run by electron-timeout-cleanup.spec.ts.
// Import zoo-test first, matching app tests and avoiding its fixture import cycle.
import { test } from '@e2e/playwright/zoo-test'

import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'
import { _electron as electron, expect } from '@playwright/test'

const eventsPath = path.join(process.cwd(), 'process-events.jsonl')

// Exercise the real test and teardown fixtures with a disposable app, without
// starting the modeling service or relying on a production renderer hang.
ElectronZoo.prototype.createInstanceIfMissing = async function (testInfo) {
  this.electron = await electron.launch({
    args: [path.join(process.cwd(), 'fixture-app.cjs'), '--no-sandbox'],
    timeout: 15_000,
  })
  const ownedProcess = this.electron.process()
  const record = (event: Record<string, unknown>) =>
    appendFileSync(
      eventsPath,
      `${JSON.stringify({ worker: testInfo.workerIndex, pid: ownedProcess.pid, ...event })}\n`
    )
  record({ event: 'launch' })
  ownedProcess.once('exit', (code, signal) =>
    record({ event: 'exit', code, signal })
  )
  this.page = await this.electron.firstWindow()
  this.context = this.electron.context()
  await this.page.waitForLoadState('load')
  await this.page.evaluate(() => {
    Object.assign(window, {
      engineDebugger: { logs: [] },
      engineCommandManager: {
        started: false,
        connection: null,
        tearDown: () => undefined,
      },
    })
    window.addEventListener('beforeunload', () => undefined)
  })
  await this.context.tracing.start({ screenshots: true, snapshots: true })
  await this.context.tracing.startChunk()
}

test('a test-body reload times out with an unresponsive renderer', async ({
  page,
  context,
}) => {
  const session = await context.newCDPSession(page)
  await session.send('Debugger.enable')
  await session.send('Debugger.pause')
  await page.reload({ timeout: 0 })
})

test('the next test runs in a fresh healthy worker', async ({ page }) => {
  await expect(page.locator('body')).toHaveText('Fixture timeout regression')
})
