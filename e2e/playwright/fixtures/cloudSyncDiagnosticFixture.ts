import { writeFile } from 'node:fs/promises'
import { cpus, platform } from 'node:os'
import {
  expect,
  test as base,
} from '@e2e/playwright/fixtures/fileLoaderDiagnosticFixture'
import type { ConsoleMessage, Frame } from '@playwright/test'

export { expect }

const prefix = '__CLOUD_SYNC_DIAG__'
const stages = new Set([
  'run',
  'outbox-before-scan',
  'initial-scan',
  'outbox-after-scan',
  'outbox-after-index',
  'pending-count',
  'remote-index',
  'index-directories',
  'index-list',
  'index-metadata',
  'index-outbox',
  'index-missing-local',
  'index-projects',
  'project',
  'project-metadata',
  'project-binding',
  'project-preflight',
  'project-local-files',
  'project-manifest',
  'project-checkpoint',
  'project-create-request',
  'project-create-issue',
])
const phases = new Set([
  'start',
  'end',
  'returned',
  'rejected',
  'handled-error',
  'progress',
])

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
    !('timeOrigin' in value) ||
    typeof value.timeOrigin !== 'number' ||
    !Number.isFinite(value.timeOrigin) ||
    value.timeOrigin < 0 ||
    !('pageMs' in value) ||
    typeof value.pageMs !== 'number' ||
    !Number.isFinite(value.pageMs) ||
    value.pageMs < 0 ||
    ('count' in value &&
      (typeof value.count !== 'number' ||
        !Number.isSafeInteger(value.count) ||
        value.count < 0))
  ) {
    return undefined
  }
  // Persist only fixed labels and numbers, never the original console object.
  return {
    stage: value.stage,
    phase: value.phase,
    invocationId: value.invocationId,
    pageMs: value.pageMs,
    timeOrigin: value.timeOrigin,
    ...('count' in value ? { count: value.count } : {}),
  }
}

export const test = base.extend<{ cloudSyncDiagnostic: undefined }>({
  cloudSyncDiagnostic: [
    async ({ page }, provide, testInfo) => {
      if (process.env.PLAYWRIGHT_CLOUD_SYNC_DIAGNOSTIC !== '1') {
        await provide(undefined)
        return
      }
      const spans: NonNullable<ReturnType<typeof parseSpan>>[] = []
      let invalidRecords = 0
      const mainFrameOrigins: ('local-app' | 'opaque' | 'other')[] = []
      const onNavigation = (frame: Frame) => {
        if (frame !== page.mainFrame()) return
        const origin = new URL(frame.url()).origin
        mainFrameOrigins.push(
          origin === 'http://localhost:3000'
            ? 'local-app'
            : origin === 'null'
              ? 'opaque'
              : 'other'
        )
      }
      onNavigation(page.mainFrame())
      page.on('framenavigated', onNavigation)
      const onConsole = (message: ConsoleMessage) => {
        const text = message.text()
        if (!text.startsWith(prefix)) return
        const span = parseSpan(text.slice(prefix.length))
        if (span) spans.push(span)
        else invalidRecords++
      }
      page.on('console', onConsole)
      try {
        await provide(undefined)
      } finally {
        page.off('console', onConsole)
        page.off('framenavigated', onNavigation)
        const output = testInfo.outputPath('cloud-sync-spans.json')
        await writeFile(
          output,
          JSON.stringify(
            {
              diagnostic: 'cloud-sync-stages',
              calibrationEligible: false,
              baseApplicationCommit: 'e9510abfb317779a6b04af21b88bc539b258416c',
              testFixtureCommit: 'cc0b8f937e976c31019c823e10697b7b92675ecd',
              diagnosticCommit: process.env.GITHUB_SHA ?? null,
              cpu: cpus()[0]?.model ?? null,
              platform: platform(),
              workerIndex: testInfo.workerIndex,
              configuredWorkers: testInfo.config.workers,
              mainFrameOrigins,
              instrumentationObserved: spans.length > 0,
              invalidRecords,
              spans,
            },
            null,
            2
          )
        )
        await testInfo.attach('cloud-sync-spans', {
          path: output,
          contentType: 'application/json',
        })
        expect(invalidRecords, 'Sync diagnostic records must be valid').toBe(0)
        if (
          testInfo.status === 'passed' &&
          testInfo.title ===
            'syncs an edit queued during first upload with the real development API'
        ) {
          expect(
            spans.some((span) => span.stage === 'project-create-issue'),
            'A passing first-upload diagnostic must observe the create request'
          ).toBe(true)
        }
      }
    },
    { auto: true },
  ],
})
