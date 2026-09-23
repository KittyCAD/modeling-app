import { appendFile } from 'node:fs/promises'
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'

/** Publish existing measurement attachments after all scored work has finished. */
export default class InteractionSummaryReporter implements Reporter {
  private sections: string[] = []

  onTestEnd(test: TestCase, result: TestResult) {
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

  async onEnd(result: FullResult) {
    const path = process.env.GITHUB_STEP_SUMMARY
    if (!path) return
    await appendFile(
      path,
      [
        '## Interaction measurements',
        `Collection suite: **${result.status}**. Latency breaches are warnings.`,
        'Harness probes intentionally generate latency warnings or collection errors.',
        ...this.sections,
        '',
      ].join('\n\n')
    )
  }
}
