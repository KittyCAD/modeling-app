import type { ElectronApplication, TestInfo } from '@playwright/test'
import type { Event, WebContents, RenderProcessGoneDetails } from 'electron'

// Collect in the main process: a crashed renderer cannot report its own exit.
export async function startRendererCrashDiagnostics(
  electron: ElectronApplication
) {
  await electron.evaluate(({ app }) => {
    type Failure = { reason: string; exitCode: number; occurredAt: string }
    const state = app as typeof app & {
      playwrightRendererFailures?: Failure[]
      playwrightRendererListener?: (
        event: Event,
        contents: WebContents,
        details: RenderProcessGoneDetails
      ) => void
    }
    if (state.playwrightRendererListener) {
      app.removeListener(
        'render-process-gone',
        state.playwrightRendererListener
      )
    }
    state.playwrightRendererFailures = []
    state.playwrightRendererListener = (_event, _contents, details) => {
      if (details.reason === 'clean-exit') return
      state.playwrightRendererFailures?.push({
        reason: details.reason,
        exitCode: details.exitCode,
        occurredAt: new Date().toISOString(),
      })
    }
    app.on('render-process-gone', state.playwrightRendererListener)
  })
}

export async function attachRendererCrashDiagnostics(
  electron: ElectronApplication | undefined,
  testInfo: Pick<TestInfo, 'attach'>
) {
  if (!electron) return
  try {
    const failures = await electron.evaluate(
      ({ app }) =>
        (app as typeof app & { playwrightRendererFailures?: unknown[] })
          .playwrightRendererFailures ?? []
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
