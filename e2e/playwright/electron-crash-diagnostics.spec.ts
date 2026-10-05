import { _electron as electron, expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import {
  attachRendererCrashDiagnostics,
  startRendererCrashDiagnostics,
} from '@e2e/playwright/fixtures/electronCrashDiagnostics'

test('retains native renderer exit evidence after a crash @desktop @macos @windows', async ({}, testInfo) => {
  const entrypoint = testInfo.outputPath('main.cjs')
  await writeFile(
    entrypoint,
    `
    const { app, BrowserWindow } = require('electron');
    app.whenReady().then(() => {
      const window = new BrowserWindow({ show: false });
      window.loadURL('data:text/html,<title>Crash diagnostics fixture</title>');
    });
  `
  )
  const application = await electron.launch({
    args: [entrypoint, '--no-sandbox'],
  })
  try {
    const page = await application.firstWindow()
    await expect(page).toHaveTitle('Crash diagnostics fixture')
    await startRendererCrashDiagnostics(application)
    // Reusing the fixture must not accumulate listeners.
    await startRendererCrashDiagnostics(application)
    const nativeExit = await application.evaluate(
      async ({ app, BrowserWindow }) => {
        const gone = new Promise<{ reason: string; exitCode: number }>(
          (resolve) => {
            app.once('render-process-gone', (_event, _contents, details) =>
              resolve(details)
            )
          }
        )
        BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()
        return await gone
      }
    )
    await attachRendererCrashDiagnostics(application, testInfo)
    expect(testInfo.attachments).toHaveLength(1)
    expect(testInfo.attachments[0].name).toBe('electron-renderer-failures')
    const failures = JSON.parse(String(testInfo.attachments[0].body))
    expect(failures).toHaveLength(1)
    expect(['crashed', 'killed']).toContain(nativeExit.reason)
    expect(failures[0]).toMatchObject({
      reason: nativeExit.reason,
      exitCode: nativeExit.exitCode,
    })
    expect(Number.isNaN(Date.parse(failures[0].occurredAt))).toBe(false)
    await attachRendererCrashDiagnostics(application, testInfo)
    expect(testInfo.attachments).toHaveLength(1)
    await startRendererCrashDiagnostics(application)
    await attachRendererCrashDiagnostics(application, testInfo)
    expect(testInfo.attachments).toHaveLength(1)
  } finally {
    await application.close()
  }
})
