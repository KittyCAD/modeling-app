import type { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'
import type { TestInfo } from '@playwright/test'

export async function startDiagnosticTrace(
  tronApp: ElectronZoo | undefined,
  testInfo: TestInfo
) {
  if (!tronApp) throw new Error('Diagnostics require Electron')
  const session = await tronApp.context.newCDPSession(tronApp.page)
  await session.send('Profiler.enable')
  await session.send('Profiler.start')
  await tronApp.electron.evaluate(({ contentTracing }) =>
    contentTracing.startRecording({
      included_categories: ['cc', 'viz', 'benchmark', 'latencyInfo'],
      excluded_categories: ['*'],
      enable_argument_filter: true,
      recording_mode: 'record-until-full',
      trace_buffer_size_in_kb: 16384,
    })
  )
  return async () => {
    const profile: unknown = await session.send('Profiler.stop')
    await testInfo.attach('cpu-profile', {
      body: JSON.stringify(profile),
      contentType: 'application/json',
    })
    const path = await tronApp.electron.evaluate(
      ({ contentTracing }, path) => contentTracing.stopRecording(path),
      testInfo.outputPath('presentation-trace.json')
    )
    await testInfo.attach('presentation-trace', {
      path,
      contentType: 'application/json',
    })
    await session.detach()
  }
}
