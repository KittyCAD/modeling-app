import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { runElectronSetup } from '@e2e/playwright/fixtures/electronLifecycle'
import type { TestInfo } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

async function launchFixtureApplication(testInfo: TestInfo, url: string) {
  const entry = testInfo.outputPath('fixture-app.cjs')
  await mkdir(path.dirname(entry), { recursive: true })
  await writeFile(
    entry,
    `const { app, BrowserWindow } = require('electron')
let window
app.whenReady().then(() => {
  window = new BrowserWindow({ show: false })
  window.loadURL(${JSON.stringify(url)})
})
`
  )
  return electron.launch({ args: [entry, '--no-sandbox'], timeout: 15_000 })
}

test.describe(
  'Electron fixture failure cleanup',
  { tag: ['@desktop', '@macos', '@windows'] },
  () => {
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a fixture pattern.
    test('a setup deadline closes a stalled reload and preserves the failure', async ({}, testInfo) => {
      let stallReload = false
      let reloadRequested = false
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        if (stallReload) {
          reloadRequested = true
          response.write('<html>')
        } else {
          response.end('<html><body>Fixture lifecycle regression</body></html>')
        }
      })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Missing local regression server address')
      }
      const url = `http://127.0.0.1:${address.port}/`
      let application:
        | Awaited<ReturnType<typeof launchFixtureApplication>>
        | undefined
      try {
        application = await launchFixtureApplication(testInfo, url)
        const ownedProcess = application.process()
        const page = await application.firstWindow()
        await page.waitForURL(url, { waitUntil: 'load' })
        stallReload = true
        const navigation = page.reload({ timeout: 0 }).then(
          () => ({ succeeded: true as const }),
          (error: unknown) => ({ succeeded: false as const, error })
        )
        await expect.poll(() => reloadRequested).toBe(true)
        const ownedApplication = application
        await expect(
          runElectronSetup(
            async () => {
              const result = await navigation
              if (!result.succeeded) {
                throw result.error
              }
            },
            () => ownedApplication.close(),
            100,
            'fixture regression setup deadline'
          )
        ).rejects.toThrow('fixture regression setup deadline')
        // close() must finish before the original setup failure is reported.
        expect(ownedProcess.exitCode).toBe(0)
        expect(ownedProcess.signalCode).toBeNull()
        expect((await navigation).succeeded).toBe(false)
      } finally {
        if (application) {
          await application.close()
        }
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
      }
    })
  }
)
