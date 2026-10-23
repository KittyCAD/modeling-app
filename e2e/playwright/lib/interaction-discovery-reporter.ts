import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import path from 'node:path'
import type { TestInfo } from '@playwright/test'
import type {
  FullConfig,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'
import type {
  DiscoveryCapture,
  DiscoveryDocument,
} from '@e2e/playwright/fixtures/interactionDiscoveryFixture'
import { reportInteractions } from '@src/lib/interactionPerformance/report'
import type { InteractionSnapshot } from '@src/lib/interactionPerformance/types'

const RAW_ATTACHMENT = 'interaction-discovery'
const SUMMARY_ATTACHMENT = 'interaction-discovery-summary'

/** Aggregate documents with matching profiles observed at checkpoints. */
export async function attachDiscoveryCapture(
  testInfo: TestInfo,
  capture: DiscoveryCapture
) {
  const groups = new Map<
    string,
    { profile: DiscoveryDocument['profile']; snapshot: InteractionSnapshot }
  >()
  for (const document of capture.documents) {
    if (!document.profileUnchangedAtCheckpoints) continue
    const registered = [...document.snapshot.registered].sort((a, b) =>
      a.id.localeCompare(b.id)
    )
    const key = JSON.stringify({ profile: document.profile, registered })
    let group = groups.get(key)
    if (!group) {
      group = {
        profile: document.profile,
        snapshot: {
          registered,
          samples: [],
          droppedSamples: 0,
          droppedPointerEvents: 0,
          visibilityInterrupted: false,
        },
      }
      groups.set(key, group)
    }
    for (const sample of document.snapshot.samples) {
      group.snapshot.samples.push({
        ...sample,
        sequence: group.snapshot.samples.length + 1,
      })
    }
    group.snapshot.droppedSamples += document.snapshot.droppedSamples
    group.snapshot.droppedPointerEvents +=
      document.snapshot.droppedPointerEvents
    group.snapshot.visibilityInterrupted ||=
      document.snapshot.visibilityInterrupted
  }
  const reports = Array.from(groups.values(), ({ profile, snapshot }) => ({
    profile,
    report: reportInteractions(snapshot, {}),
  }))
  const documentErrors = capture.documents.flatMap((document, index) =>
    reportInteractions(document.snapshot, {}).errors.map(
      (error) => `Document ${index + 1}: ${error}`
    )
  )
  await testInfo.attach(RAW_ATTACHMENT, {
    contentType: 'application/json',
    body: JSON.stringify({
      schemaVersion: 1,
      coverage: 'partial',
      ...capture,
      documentErrors,
      reports,
    }),
  })
  await testInfo.attach(SUMMARY_ATTACHMENT, {
    contentType: 'text/plain',
    body: [
      `Captured documents: ${capture.documents.length}. Partial discovery covers the main page after fixture setup; navigation can lose inputs between checkpoints.`,
      'The final snapshot can precede delayed Event Timing delivery.',
      'Profile changes between checkpoints can be missed. Profiles are not verified for each sample.',
      `Documents excluded after their observed profile changed: ${capture.documents.filter((document) => !document.profileUnchangedAtCheckpoints).length}.`,
      ...capture.diagnostics,
      ...documentErrors,
      ...reports.flatMap(({ profile, report }) => [
        `Profile: ${JSON.stringify(profile)}`,
        `Collection errors: ${report.errors.length}; latency warnings: ${report.violations.length}; unattributed clicks: ${report.unattributed}.`,
        ...report.coverage.map(
          (row) =>
            `${row.id}: ${row.measured}/${row.exercised} measured, expectation under ${row.budgetMs} ms, outcome p50/p95/max ${row.p50Ms ?? 'unreported'}/${row.p95Ms ?? 'unreported'}/${row.maximumMs ?? 'unreported'} ms, Event Timing ${row.eventTimingMeasured}/${row.exercised}, maximum ${row.responsivenessMaximumMs ?? 'unreported'} ms.`
        ),
        ...report.errors,
      ]),
    ].join('\n'),
  })
}

/** Persist discovery attachments with runner metadata; never override status. */
export default class InteractionDiscoveryReporter implements Reporter {
  private pending = Promise.resolve()
  private initialized = false
  private workers = 0
  private readonly directory: string

  constructor(options: { outputDirectory?: string } = {}) {
    this.directory = path.resolve(
      options.outputDirectory ?? 'test-results/interaction-discovery'
    )
  }

  onBegin(config: FullConfig) {
    this.workers = config.workers
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const raw = result.attachments.find((item) => item.name === RAW_ATTACHMENT)
    const summary = result.attachments.find(
      (item) => item.name === SUMMARY_ATTACHMENT
    )
    if (!raw) return
    const project = test.parent.project()
    const metadata = {
      testId: test.id,
      scenario: test.titlePath(),
      project: project?.name,
      retry: result.retry,
      repeatIndex: test.repeatEachIndex,
      workerIndex: result.workerIndex,
      status: result.status,
      target: process.env.TARGET ?? 'desktop',
      platform: platform(),
      architecture: arch(),
      build: process.env.INTERACTION_DISCOVERY_BUILD ?? 'unspecified',
      commit: process.env.CI_COMMIT_SHA || process.env.GITHUB_SHA || null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      trace: project?.use.trace ?? 'off',
      workers: this.workers,
    }
    this.pending = this.pending
      .then(async () => {
        const content =
          raw.body?.toString('utf8') ??
          (raw.path ? await readFile(raw.path, 'utf8') : undefined)
        if (!content) throw new Error('Discovery attachment unavailable')
        // The fixture owns the typed payload. The reporter preserves it whole and
        // adds Playwright metadata, rather than maintaining another schema parser.
        const discovery: unknown = JSON.parse(content)
        const text =
          summary?.body?.toString('utf8') ??
          (summary?.path
            ? await readFile(summary.path, 'utf8')
            : 'Summary unavailable.')
        if (!this.initialized) {
          await mkdir(this.directory, { recursive: true })
          await writeFile(path.join(this.directory, 'discovery.jsonl'), '')
          await writeFile(
            path.join(this.directory, 'summary.txt'),
            'Report-only functional-test discovery; separate from the controlled performance profile.\n'
          )
          this.initialized = true
        }
        await appendFile(
          path.join(this.directory, 'discovery.jsonl'),
          `${JSON.stringify({ metadata, discovery })}\n`
        )
        await appendFile(
          path.join(this.directory, 'summary.txt'),
          `\n${JSON.stringify(metadata)}\n${text}\n`
        )
      })
      .catch(() => {
        console.warn('Interaction discovery attachment could not be reported.')
      })
  }

  async onEnd(): Promise<void> {
    await this.pending
  }
}
