import type { EventEmitter } from 'node:events'
import type { BrowserContext, TestInfo } from '@playwright/test'

// Temporary diagnostics: preserve teardown behavior and log timings, never URLs,
// protocol payloads, or exception messages from authenticated connections.
export async function closeWithWebKitTeardownDiagnostics(
  context: BrowserContext,
  testInfo: TestInfo
) {
  const diagnosticEvents = process as EventEmitter
  const started = performance.now()
  const emit = (phase: string, details: Record<string, unknown> = {}) => {
    console.log(
      '[webkit-teardown]',
      JSON.stringify({
        test: testInfo.title,
        retry: testInfo.retry,
        repeat: testInfo.repeatEachIndex,
        worker: testInfo.workerIndex,
        phase,
        elapsedMs: Math.round(performance.now() - started),
        timestamp: new Date().toISOString(),
        ...details,
      })
    )
  }
  const label = `${testInfo.workerIndex}:${testInfo.repeatEachIndex}:${testInfo.retry}:${testInfo.title}`
  for (const [pageIndex, page] of context.pages().entries()) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const resources = await Promise.race([
        page
          .evaluate(() => {
            const diagnostics = Reflect.get(
              window,
              '__webkitResourceDiagnostics'
            ) as { snapshot: () => unknown } | undefined
            return diagnostics?.snapshot() ?? null
          })
          .catch(() => null),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 1000)
        }),
      ])
      emit('resources.beforeClose', { pageIndex, resources })
    } finally {
      clearTimeout(timer)
    }
  }
  const onContextClosed = () => emit('context.closed')
  const onBrowserDisconnected = () => emit('browser.disconnected')
  const onPageClosed = () => emit('page.closed')
  const browser = context.browser()
  const pages = context.pages()
  context.on('close', onContextClosed)
  browser?.on('disconnected', onBrowserDisconnected)
  for (const page of pages) page.on('close', onPageClosed)

  const originalDispose = context.request.dispose.bind(context.request)
  const originalStopChunk = context.tracing.stopChunk.bind(context.tracing)
  const originalStop = context.tracing.stop.bind(context.tracing)
  const timed = async <T>(phase: string, action: () => Promise<T>) => {
    const phaseStarted = performance.now()
    emit(`${phase}.start`)
    let completed = false
    try {
      const result = await action()
      completed = true
      return result
    } finally {
      emit(`${phase}.end`, {
        completed,
        durationMs: Math.round(performance.now() - phaseStarted),
      })
    }
  }
  context.request.dispose = (options) =>
    timed('request.dispose', () => originalDispose(options))
  context.tracing.stopChunk = (options) =>
    timed('trace.stopChunk', () => originalStopChunk(options))
  context.tracing.stop = (options) =>
    timed('trace.stop', () => originalStop(options))

  try {
    diagnosticEvents.emit('webkit-teardown-diagnostic', {
      stage: 'start',
      label,
    })
    await timed('context.close', () => context.close())
  } finally {
    diagnosticEvents.emit('webkit-teardown-diagnostic', { stage: 'end', label })
    context.request.dispose = originalDispose
    context.tracing.stopChunk = originalStopChunk
    context.tracing.stop = originalStop
    context.off('close', onContextClosed)
    browser?.off('disconnected', onBrowserDisconnected)
    for (const page of pages) page.off('close', onPageClosed)
  }
}
