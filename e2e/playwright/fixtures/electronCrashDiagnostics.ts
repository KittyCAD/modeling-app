import type { ElectronApplication, TestInfo } from '@playwright/test'

// Collect in the main process: a crashed renderer cannot report its own exit.
export async function startRendererCrashDiagnostics(
  electron: ElectronApplication
) {
  await electron.evaluate(({ app }) => {
    type Failure = { reason: string; exitCode: number; occurredAt: string }
    const state = app as typeof app & {
      playwrightRendererFailures?: Failure[]
    }
    if (state.playwrightRendererFailures) {
      state.playwrightRendererFailures.length = 0
      return
    }
    const failures: Failure[] = []
    state.playwrightRendererFailures = failures
    app.on('render-process-gone', (_event, _contents, details) => {
      if (details.reason === 'clean-exit') return
      failures.push({
        reason: details.reason,
        exitCode: details.exitCode,
        occurredAt: new Date().toISOString(),
      })
    })
  })
}

export async function attachRendererCrashDiagnostics(
  electron: ElectronApplication | undefined,
  testInfo: TestInfo
) {
  if (!electron) return
  try {
    const failures = await electron.evaluate(
      ({ app }) =>
        (
          app as typeof app & { playwrightRendererFailures?: unknown[] }
        ).playwrightRendererFailures?.splice(0) ?? []
    )
    if (failures.length === 0) return
    const body = JSON.stringify(failures, null, 2)
    console.error(`Electron renderer failure: ${body}`)
    await testInfo.attach('electron-renderer-failures', {
      body,
      contentType: 'application/json',
    })
  } catch (error) {
    // Diagnostics must not replace the original setup/test error.
    console.warn('Unable to collect Electron renderer failures', error)
  }
}
