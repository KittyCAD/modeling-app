import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@e2e/playwright/base-test'
import type { ConsoleMessage } from '@playwright/test'

export { expect }

const prefix = '__FILE_LOADER_DIAG__'
const stages = new Set([
  'loader',
  'wasm',
  'application-settings',
  'library-ownership',
  'project-settings',
  'fallback-project-info',
  'file-stat',
  'project-info',
  'settings-idle-before-load',
  'settings-idle-after-load',
  'open-project',
  'open-editor',
])
const phases = new Set(['start', 'end', 'returned', 'redirected', 'rejected'])

function parseSpan(text: string) {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('stage' in value) ||
    typeof value.stage !== 'string' ||
    !stages.has(value.stage) ||
    !('phase' in value) ||
    typeof value.phase !== 'string' ||
    !phases.has(value.phase) ||
    !('invocationId' in value) ||
    typeof value.invocationId !== 'number' ||
    !Number.isSafeInteger(value.invocationId) ||
    value.invocationId < 1 ||
    !('pageMs' in value) ||
    typeof value.pageMs !== 'number' ||
    !Number.isFinite(value.pageMs) ||
    value.pageMs < 0
  ) {
    return undefined
  }
  // Reconstruct the allowlisted fields instead of persisting console objects.
  return {
    stage: value.stage,
    phase: value.phase,
    invocationId: value.invocationId,
    pageMs: value.pageMs,
  }
}

export const test = base.extend<{ fileLoaderDiagnostic: undefined }>({
  fileLoaderDiagnostic: [
    async ({ page }, provide, testInfo) => {
      if (process.env.PLAYWRIGHT_FILE_LOADER_DIAGNOSTIC !== '1') {
        await provide(undefined)
        return
      }

      const spans: NonNullable<ReturnType<typeof parseSpan>>[] = []
      let invalidRecords = 0
      const onConsole = (message: ConsoleMessage) => {
        const text = message.text()
        if (!text.startsWith(prefix)) return
        const span = parseSpan(text.slice(prefix.length))
        if (span) spans.push(span)
        else invalidRecords++
      }
      // The existing test closes its page in finally. Collect in Node while it
      // runs so unfinished spans survive that cleanup without page globals.
      page.on('console', onConsole)
      try {
        await provide(undefined)
      } finally {
        page.off('console', onConsole)
        const output = testInfo.outputPath('file-loader-spans.json')
        await writeFile(
          output,
          JSON.stringify(
            {
              diagnostic: 'file-loader-awaits',
              calibrationEligible: false,
              instrumentationObserved: spans.length > 0,
              invalidRecords,
              spans,
            },
            null,
            2
          )
        )
        await testInfo.attach('file-loader-spans', {
          path: output,
          contentType: 'application/json',
        })
        expect(invalidRecords, 'Loader diagnostic records must be valid').toBe(
          0
        )
        if (testInfo.status === 'passed') {
          const completedLoader = spans.some(
            (start) =>
              start.stage === 'loader' &&
              start.phase === 'start' &&
              spans.some(
                (terminal) =>
                  terminal.stage === 'loader' &&
                  terminal.invocationId === start.invocationId &&
                  (terminal.phase === 'returned' ||
                    terminal.phase === 'redirected' ||
                    terminal.phase === 'rejected')
              )
          )
          expect(
            completedLoader,
            'A passing diagnostic must capture a loader start and terminal phase'
          ).toBe(true)
        }
      }
    },
    { auto: true },
  ],
})
