/** One running evaluation and one newest pending candidate. */
export class PreviewQueue<Input, Output> {
  private revision = 0
  private pending: { input: Input; revision: number } | undefined
  private running = false
  private closed = false

  constructor(
    private readonly evaluate: (input: Input) => Promise<Output>,
    private readonly publish: (
      output: Output,
      isCurrent: () => boolean
    ) => Promise<void>,
    private readonly fail: (error: unknown) => void
  ) {}

  update(input: Input) {
    if (this.closed) return
    this.pending = { input, revision: ++this.revision }
    void this.drain()
  }

  invalidate() {
    this.revision++
    this.pending = undefined
  }

  close() {
    this.closed = true
    this.invalidate()
  }

  private async drain() {
    if (this.running || this.closed) return
    this.running = true
    try {
      while (this.pending && !this.closed) {
        const { input, revision } = this.pending
        this.pending = undefined
        const isCurrent = () => !this.closed && revision === this.revision
        try {
          const output = await this.evaluate(input)
          if (isCurrent()) await this.publish(output, isCurrent)
        } catch (error) {
          if (isCurrent()) this.fail(error)
        }
      }
    } finally {
      this.running = false
    }
  }
}
