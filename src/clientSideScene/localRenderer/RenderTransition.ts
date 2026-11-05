/** Fade into tracing; return to the real-time view immediately. */
export class RenderTransition {
  private from = 0
  private target = 0
  private started = 0
  value = 0
  active = false

  update(traced: boolean, now: number, animate: boolean) {
    const target = traced ? 1 : 0
    if (!animate || !traced) {
      this.from = this.target = this.value = target
      this.active = false
      return this.value
    }
    this.advance(now)
    if (target !== this.target) {
      this.from = this.value
      this.target = target
      this.started = now
    }
    return this.advance(now)
  }

  private advance(now: number) {
    const progress = Math.min(1, Math.max(0, (now - this.started) / 200))
    this.value = this.from + (this.target - this.from) * progress
    this.active = progress < 1 && this.from !== this.target
    return this.value
  }
}
