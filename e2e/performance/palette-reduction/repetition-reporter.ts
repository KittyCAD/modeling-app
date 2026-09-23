import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'

export default class RepetitionReporter implements Reporter {
  private finalRepeatIndex = -1
  private executed = false
  private validatedFinal = false

  onBegin(config: FullConfig) {
    // Playwright resolves CLI repeat overrides in the runner, after loading the
    // worker's project config. Forward that resolved count before workers spawn.
    const repetitions =
      config.projects.length === 1 ? config.projects[0].repeatEach : 0
    this.finalRepeatIndex = repetitions - 1
    process.env.PALETTE_REDUCTION_REPEAT_EACH = String(repetitions)
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'skipped') return
    this.executed = true
    if (
      test.repeatEachIndex !== this.finalRepeatIndex ||
      result.status !== 'passed'
    )
      return
    const body = result.attachments.find(
      (attachment) => attachment.name === 'palette-reduction-fidelity'
    )?.body
    if (!body) return
    try {
      const fidelity: unknown = JSON.parse(body.toString())
      this.validatedFinal =
        typeof fidelity === 'object' &&
        fidelity !== null &&
        'validated' in fidelity &&
        fidelity.validated === true
    } catch {
      // Invalid evidence cannot satisfy the aggregate guard.
    }
  }

  async onEnd(
    result: FullResult
  ): Promise<{ status: FullResult['status'] } | undefined> {
    // --list reports discovery without onTestEnd calls. Executed partial runs
    // must include successful final fidelity before they can pass.
    if (this.executed && !this.validatedFinal && result.status === 'passed') {
      console.error(
        'Palette reduction has no successful final fidelity validation; timings are not validated.'
      )
      return { status: 'failed' }
    }
  }
}
