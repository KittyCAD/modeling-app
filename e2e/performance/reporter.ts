import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { reportComparisonRun } from '@e2e/performance/comparison-report'
import type { ComparisonAttempt } from '@e2e/performance/comparison-report'
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'

/** Decide performance only after the complete, unchanged collection schedule. */
export default class InteractionSummaryReporter implements Reporter {
  private sections: string[] = []
  private attempts: ComparisonAttempt[] = []
  private executionErrors: string[] = []
  private readonly listOnly: boolean

  constructor(options: unknown) {
    // The installed runner passes _mode to reporter constructors for --list.
    // Empty executed selections still go through the completeness checks.
    this.listOnly =
      typeof options === 'object' &&
      options !== null &&
      '_mode' in options &&
      options._mode === 'list'
  }

  onBegin(config: FullConfig) {
    if (config.workers !== 1)
      this.executionErrors.push('Comparison requires exactly one worker.')
    if (
      config.projects.some(
        (project) => project.retries !== 0 || project.repeatEach !== 1
      )
    )
      this.executionErrors.push(
        'Comparison and probes require zero retries and one execution per test.'
      )
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.attempts.push({
      testId: test.id,
      project: test.parent.project()?.name ?? '',
      status: result.status,
      expectedStatus: test.expectedStatus,
      retry: result.retry,
      repeatIndex: test.repeatEachIndex,
      measurements: result.attachments
        .filter((attachment) => attachment.name === 'interaction-measurements')
        .map((attachment) =>
          attachment.contentType === 'application/json'
            ? (attachment.body?.toString('utf8') ?? null)
            : null
        ),
    })
    const summary = result.attachments.find(
      (attachment) => attachment.name === 'interaction-summary'
    )
    const title =
      `${test.title}, repetition ${test.repeatEachIndex + 1}: ${result.status}`
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
    this.sections.push(
      `<details>\n<summary>${title}</summary>\n\n\`\`\`text\n${summary?.body?.toString('utf8') ?? 'No measurements produced. See the test failure.'}\n\`\`\`\n\n</details>`
    )
  }

  async onEnd(
    result: FullResult
  ): Promise<{ status: FullResult['status'] } | undefined> {
    if (this.listOnly) return
    if (result.status !== 'passed')
      this.executionErrors.push(`Playwright execution ended ${result.status}.`)
    const report = reportComparisonRun(this.attempts, this.executionErrors)
    const output = path.resolve(
      'test-results/interaction-performance/comparison.json'
    )
    try {
      await mkdir(path.dirname(output), { recursive: true })
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
    } catch {
      console.error('Could not preserve the interaction comparison artifact.')
      return { status: 'failed' }
    }
    const summaryPath = process.env.GITHUB_STEP_SUMMARY
    if (summaryPath) {
      const ms = (value: number | null) =>
        value === null ? 'unavailable' : `${value.toFixed(1)} ms`
      const table = report.strata.map(
        (row) =>
          `| ${row.context} | ${row.id} | ${row.phase} | ${row.metric} | ${ms(row.medianDeltaMs)} | ${row.positivePairs}/10 | ${row.completePairs}/10 | ${row.status} |`
      )
      try {
        await appendFile(
          summaryPath,
          [
            '## Interaction measurements',
            `Comparison: **${report.status === 'no-regression' ? 'no detected regression' : report.status}**. Playwright collection: **${result.status}**.`,
            'First-use, typical repeated-use (session median), and repeated-use tail (session maximum of ten) are compared separately. These are renderer first-use measurements, not proof of a cold host GPU cache.',
            'Provisional regression rule: median paired increase at least 24 ms, at least 9/10 positive pairs, and positive medians in both execution-order groups. All outcome strata are required; fully observed Event Timing strata can also fail. A/A and real-delay calibration remain required.',
            `Unavailable presentation strata: **${report.unavailablePresentationStrata}**. Their missing entries remain unknown, not zero or proof of fast presentation. No detected regression applies only to observable outcomes and complete presentation strata.`,
            `Absolute 150 ms target breaches: **${report.targetBreaches.length}**. Every breach and raw capture remains in comparison.json; the target is reported separately from added slowness.`,
            'Harness probes run after collection; their intentional delays or missing data must be rejected by their own passing assertions.',
            '| Context | Interaction | Phase | Metric | Paired median increase | Slower pairs | Complete pairs | Result |\n| --- | --- | --- | --- | --- | --- | --- | --- |',
            table.join('\n'),
            ...report.collectionErrors.map(
              (error) => `Collection error: ${error}`
            ),
            ...this.sections,
            '',
          ].join('\n\n')
        )
      } catch {
        console.error(
          'Could not publish the interaction comparison summary; comparison.json was preserved.'
        )
        return { status: 'failed' }
      }
    }
    if (report.status !== 'no-regression') {
      console.error(
        `Interaction comparison failed: ${report.status}; see comparison.json.`
      )
      return { status: 'failed' }
    }
    return { status: 'passed' }
  }
}
